// 会话检索索引的 DDL 与维护语句，单一事实来源。
//
// 迁移与单测共用同一份语句，避免两处建表逻辑各自演化。
//
// 设计：
//   1. `part.data` 是 JSON，FTS5 无法直接索引 `$.text`，所以先落一张影子表
//      `part_text`，用触发器从 `part` 同步（只收 `type === "text"` 的 part）。
//      影子表只存检索必需的列——时间从 `message` 取，避免多一份需要同步的状态。
//   2. `part_fts` 是 external-content FTS5，内容指向 `part_text`，用标准触发器
//      模式维护增删改。
//   3. 分词器用 `trigram`：它对任意长度 ≥3 的子串都能命中，包括中文——这正是
//      LIKE 全表扫想解决而没解决的问题。短于 3 字的查询仍走 LIKE 回退。

/** 建表 + 回填。在迁移里执行，也在单测里执行；语句幂等，可重复运行。 */
export const SESSION_SEARCH_INDEX_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS \`part_text\` (
     \`id\` text PRIMARY KEY NOT NULL,
     \`message_id\` text NOT NULL,
     \`session_id\` text NOT NULL,
     \`text\` text NOT NULL
   )`,

  `INSERT INTO \`part_text\` (\`id\`, \`message_id\`, \`session_id\`, \`text\`)
     SELECT \`id\`, \`message_id\`, \`session_id\`, json_extract(\`data\`, '$.text')
       FROM \`part\`
      WHERE json_extract(\`data\`, '$.type') = 'text'
        AND json_extract(\`data\`, '$.text') IS NOT NULL
   ON CONFLICT(\`id\`) DO UPDATE SET
     \`text\` = excluded.\`text\`,
     \`message_id\` = excluded.\`message_id\`,
     \`session_id\` = excluded.\`session_id\``,

  `CREATE INDEX IF NOT EXISTS \`part_text_session_idx\` ON \`part_text\` (\`session_id\`)`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS \`part_fts\` USING fts5(
     \`text\`,
     content='part_text',
     content_rowid='rowid',
     tokenize='trigram'
   )`,

  // 从影子表重建索引：迁移时对已有数据做一次，之后由触发器增量维护。
  `INSERT INTO \`part_fts\` (\`part_fts\`) VALUES ('rebuild')`,

  // part -> part_text
  `CREATE TRIGGER IF NOT EXISTS \`part_text_ai\` AFTER INSERT ON \`part\` BEGIN
     INSERT INTO \`part_text\` (\`id\`, \`message_id\`, \`session_id\`, \`text\`)
       SELECT new.\`id\`, new.\`message_id\`, new.\`session_id\`, json_extract(new.\`data\`, '$.text')
        WHERE json_extract(new.\`data\`, '$.type') = 'text'
          AND json_extract(new.\`data\`, '$.text') IS NOT NULL;
   END`,

  `CREATE TRIGGER IF NOT EXISTS \`part_text_au\` AFTER UPDATE ON \`part\` BEGIN
     DELETE FROM \`part_text\` WHERE \`id\` = old.\`id\`;
     INSERT INTO \`part_text\` (\`id\`, \`message_id\`, \`session_id\`, \`text\`)
       SELECT new.\`id\`, new.\`message_id\`, new.\`session_id\`, json_extract(new.\`data\`, '$.text')
        WHERE json_extract(new.\`data\`, '$.type') = 'text'
          AND json_extract(new.\`data\`, '$.text') IS NOT NULL;
   END`,

  `CREATE TRIGGER IF NOT EXISTS \`part_text_ad\` AFTER DELETE ON \`part\` BEGIN
     DELETE FROM \`part_text\` WHERE \`id\` = old.\`id\`;
   END`,

  // part_text -> part_fts（FTS5 external-content 的标准维护模式）
  `CREATE TRIGGER IF NOT EXISTS \`part_text_fts_ai\` AFTER INSERT ON \`part_text\` BEGIN
     INSERT INTO \`part_fts\` (\`rowid\`, \`text\`) VALUES (new.\`rowid\`, new.\`text\`);
   END`,

  `CREATE TRIGGER IF NOT EXISTS \`part_text_fts_au\` AFTER UPDATE ON \`part_text\` BEGIN
     INSERT INTO \`part_fts\` (\`part_fts\`, \`rowid\`, \`text\`) VALUES ('delete', old.\`rowid\`, old.\`text\`);
     INSERT INTO \`part_fts\` (\`rowid\`, \`text\`) VALUES (new.\`rowid\`, new.\`text\`);
   END`,

  `CREATE TRIGGER IF NOT EXISTS \`part_text_fts_ad\` AFTER DELETE ON \`part_text\` BEGIN
     INSERT INTO \`part_fts\` (\`part_fts\`, \`rowid\`, \`text\`) VALUES ('delete', old.\`rowid\`, old.\`text\`);
   END`,
]

/** trigram 分词器最小的可匹配长度。短于它的查询走 LIKE 回退。 */
export const TRIGRAM_MIN_LENGTH = 3

/**
 * 把用户输入变成 FTS5 的字面量短语查询。
 *
 * trigram 分词器下，双引号短语等价于「包含该子串」，且不会把 `%` / `_` / `-`
 * 之类字符当成语法。内部的双引号按 FTS5 规则用两个双引号转义。
 */
export function toFtsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`
}
