import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel, InstallationVersion } from "@gyccode/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  })
  const workspaceSummary = createMemo(() => {
    const sessions = sync.data.session
    // 2026-09-30（每任务成本 P0）：子代理用量已由 projector.rollupUsage 逐级上卷到
    // 祖先，父会话的 cost 含整棵子树。对全表求和会把父子各算一遍而翻倍，因此只
    // 统计根会话（无父，或父会话不在当前列表中 —— 后者含父被删除的孤儿）。
    const ids = new Set(sessions.map((s) => s.id))
    const roots = sessions.filter((s) => s.parentID === undefined || !ids.has(s.parentID))
    let tokens = 0
    let cost = 0
    for (const s of roots) {
      if (s.tokens) {
        tokens += s.tokens.input + s.tokens.output + s.tokens.reasoning + s.tokens.cache.read + s.tokens.cache.write
      }
      cost += s.cost ?? 0
    }
    return { tokens, cost, active: roots.length }
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            visible: true,
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <pluginRuntime.Slot
              name="sidebar_title"
              mode="single_winner"
              session_id={props.sessionID}
              title={session()!.title}
              share_url={session()!.share?.url}
            >
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{session()!.title}</b>
                </text>
                <Show when={InstallationChannel !== "latest"}>
                  <text fg={theme.textMuted}>{props.sessionID}</text>
                </Show>
                <Show when={session()!.workspaceID}>
                  <text fg={theme.textMuted}>
                    <Show
                      when={workspace()}
                      fallback={<WorkspaceLabel type="unknown" name={session()!.workspaceID!} status="error" icon />}
                    >
                      {(item) => (
                        <WorkspaceLabel
                          type={item().type}
                          name={item().name}
                          status={project.workspace.status(item().id) ?? "error"}
                          icon
                        />
                      )}
                    </Show>
                    <Show when={workspaceSummary().tokens > 0 || workspaceSummary().cost > 0}>
                      <text fg={theme.textMuted}>
                        Workspace Context: {workspaceSummary().tokens.toLocaleString()} tokens · {workspaceSummary().active} sessions · Cost {money.format(workspaceSummary().cost)}
                      </text>
                    </Show>
                  </text>
                </Show>
                <Show when={session()!.share?.url}>
                  <text fg={theme.textMuted}>{session()!.share!.url}</text>
                </Show>
              </box>
            </pluginRuntime.Slot>
            <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span> <b>GYC</b>
              <span style={{ fg: theme.text }}>
                <b>CODE</b>
              </span>{" "}
              <span>{InstallationVersion}</span>
            </text>
          </pluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
