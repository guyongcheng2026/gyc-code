import re
with open('src/gyccode/skill/compose/bundle.gen.ts', 'r', encoding='utf-8') as f:
    content = f.read()
matches = re.findall(r'"([^"]+)":\s*{', content)
for m in matches:
    if not m.startswith('SKILL'):
        print(m)