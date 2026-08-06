import { createContext, createMemo, useContext, type ParentProps } from "solid-js"

export function createSimpleContext<T, Props extends Record<string, any>>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
}) {
  const ctx = createContext<T>()

  return {
    context: ctx,
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)
      return createMemo(() => {
        if (init.ready === undefined || init.ready === true) {
          return (
            // @ts-expect-error
            <ctx.Provider value={init}>{props.children}</ctx.Provider>
          )
        }
        return undefined
      })
    },
    use() {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a context provider`)
      return value
    },
  }
}