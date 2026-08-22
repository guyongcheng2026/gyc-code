import { createContext, createMemo, useContext, type JSX, type ParentProps } from "solid-js"

export function createSimpleContext<T, Props extends Record<string, any>>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
}) {
  const ctx = createContext<T>()

  return {
    context: ctx,
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props) as T & { ready?: boolean }
      return createMemo(() => {
        if (init.ready === undefined || init.ready === true) {
          return <ctx.Provider value={init}>{props.children}</ctx.Provider>
        }
        return undefined
      }) as unknown as JSX.Element
    },
    use() {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a context provider`)
      return value
    },
  }
}
