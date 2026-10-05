import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import { settled } from "../util/fire-and-forget"

interface DialogSessionRenameProps {
  session: string
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const session = createMemo(() => sync.session.get(props.session))

  return (
    <DialogPrompt
      title="重命名会话"
      value={session()?.title}
      onConfirm={(value) => {
        settled(
          sdk.client.session.update({
            sessionID: props.session,
            title: value,
          }),
          "tui.dialog",
        )
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
