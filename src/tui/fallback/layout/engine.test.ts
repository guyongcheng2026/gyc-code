import { describe, expect, test } from "bun:test"
import { computeLayout, dumpLayout, readStyle, type LayoutNode } from "./engine"

interface TestNode extends LayoutNode {
	children: TestNode[]
	contentHeight?: number
}

function node(type: string, props: Record<string, unknown> = {}, children: TestNode[] = []): TestNode {
	return {
		type,
		props,
		children,
		layout: { x: 0, y: 0, width: 0, height: 0 },
	}
}

/** 叶子测量：text 按 1 行、宽 = 字符数；其余 0。 */
const opts = {
	measureLeaf(n: LayoutNode) {
		if (n.type === "text") {
			const text = typeof n.props.text === "string" ? n.props.text : ""
			return { width: text.length, height: 1 }
		}
		return { width: 0, height: 0 }
	},
}

function layout(root: TestNode, width: number, height: number): TestNode {
	computeLayout(root, { width, height }, opts)
	return root
}

function rects(root: TestNode) {
	return dumpLayout(root).map((entry) => ({ type: entry.type, ...entry.rect }))
}

describe("布局引擎：主轴分配", () => {
	test("纵向堆叠按高度累加", () => {
		const a = node("box", { height: 1 })
		const b = node("box", { height: 2 })
		const root = layout(node("box", {}, [a, b]), 10, 5)
		expect(a.layout).toEqual({ x: 0, y: 0, width: 10, height: 1 })
		expect(b.layout).toEqual({ x: 0, y: 1, width: 10, height: 2 })
		expect(root.contentHeight).toBe(3)
	})

	test("flexGrow 吸收剩余空间", () => {
		const a = node("box", { height: 2 })
		const b = node("box", { flexGrow: 1 })
		layout(node("box", {}, [a, b]), 10, 10)
		expect(a.layout.height).toBe(2)
		expect(b.layout).toEqual({ x: 0, y: 2, width: 10, height: 8 })
	})

	test("legacy flex:true 等价 flexGrow:1 + basis:0", () => {
		const a = node("box", { height: 1 })
		const b = node("box", { flex: true })
		layout(node("box", {}, [a, b]), 10, 10)
		expect(b.layout.height).toBe(9)
		const style = readStyle({ flex: true })
		expect([style.flexGrow, style.flexShrink, style.flexBasis]).toEqual([1, 1, 0])
	})

	test("flexShrink 按 shrink 因子收缩（默认 0，需显式声明）", () => {
		// Yoga/opentui 的 flexShrink 默认 0（与 Web CSS 的 1 不同），故产线有 98 处显式声明
		const a = node("box", { width: 8, height: 1, flexShrink: 1 })
		const b = node("box", { width: 8, height: 1, flexShrink: 1 })
		layout(node("box", { flexDirection: "row" }, [a, b]), 10, 1)
		expect(a.layout.width).toBe(5)
		expect(b.layout.width).toBe(5)
		expect(b.layout.x).toBe(5)
	})

	test("未声明 flexShrink 时溢出而不收缩", () => {
		const a = node("box", { width: 8, height: 1 })
		const b = node("box", { width: 8, height: 1 })
		layout(node("box", { flexDirection: "row" }, [a, b]), 10, 1)
		expect(a.layout.width).toBe(8)
		expect(b.layout.width).toBe(8)
	})

	test("gap 沿主轴生效且不计入末项之后", () => {
		const a = node("box", { height: 1 })
		const b = node("box", { height: 1 })
		layout(node("box", { gap: 1 }, [a, b]), 10, 5)
		expect(a.layout.y).toBe(0)
		expect(b.layout.y).toBe(2)
	})
})

describe("布局引擎：盒模型", () => {
	test("border + padding 内缩内容区", () => {
		const child = node("box", { height: 1 })
		layout(node("box", { border: "single", padding: 1 }, [child]), 10, 5)
		expect(child.layout).toEqual({ x: 2, y: 2, width: 6, height: 1 })
	})

	test("margin 推开子项", () => {
		const child = node("box", { height: 1, margin: { top: 2, left: 1 } })
		layout(node("box", {}, [child]), 10, 5)
		expect(child.layout.x).toBe(1)
		expect(child.layout.y).toBe(2)
	})

	test("百分比宽高相对父内容盒", () => {
		const child = node("box", { width: "50%", height: "50%" })
		layout(node("box", {}, [child]), 10, 10)
		expect(child.layout.width).toBe(5)
		expect(child.layout.height).toBe(5)
	})

	test("min/max 约束生效", () => {
		const wide = node("box", { width: 8, maxWidth: 5, height: 1 })
		layout(node("box", {}, [wide]), 10, 3)
		expect(wide.layout.width).toBe(5)
	})
})

describe("布局引擎：对齐与换行", () => {
	test("justifyContent center 居中主轴", () => {
		const child = node("box", { height: 1 })
		layout(node("box", { justifyContent: "center" }, [child]), 10, 5)
		expect(child.layout.y).toBe(2)
	})

	test("justifyContent space-between 首尾贴边", () => {
		const a = node("box", { height: 1 })
		const b = node("box", { height: 1 })
		layout(node("box", { justifyContent: "space-between" }, [a, b]), 10, 5)
		expect(a.layout.y).toBe(0)
		expect(b.layout.y).toBe(4)
	})

	test("alignItems center 居中交叉轴", () => {
		const child = node("box", { width: 2, height: 1 })
		layout(node("box", { flexDirection: "row", alignItems: "center" }, [child]), 10, 5)
		expect(child.layout.y).toBe(2)
	})

	test("alignItems stretch 拉伸未指定交叉尺寸的子项", () => {
		// CSS 语义：stretch 只对交叉轴尺寸为 auto 的子项生效
		const auto = node("box", {})
		layout(node("box", { flexDirection: "row" }, [auto]), 10, 4)
		expect(auto.layout.height).toBe(4)
	})

	test("显式交叉尺寸不被 stretch 覆盖", () => {
		const fixed = node("box", { height: 1 })
		layout(node("box", { flexDirection: "row" }, [fixed]), 10, 4)
		expect(fixed.layout.height).toBe(1)
	})

	test("flexWrap 换行并逐行堆叠", () => {
		const a = node("box", { width: 2, height: 1 })
		const b = node("box", { width: 2, height: 1 })
		const c = node("box", { width: 2, height: 1 })
		layout(node("box", { flexDirection: "row", flexWrap: "wrap" }, [a, b, c]), 4, 5)
		expect([a.layout.x, a.layout.y]).toEqual([0, 0])
		expect([b.layout.x, b.layout.y]).toEqual([2, 0])
		expect([c.layout.x, c.layout.y]).toEqual([0, 1])
	})
})

describe("布局引擎：绝对定位", () => {
	test("absolute 相对 padding box 按 inset 定位", () => {
		const overlay = node("box", { position: "absolute", top: 1, left: 2, width: 3, height: 2 })
		layout(node("box", { padding: 1 }, [overlay]), 10, 5)
		expect(overlay.layout).toEqual({ x: 3, y: 2, width: 3, height: 2 })
	})

	test("absolute 不参与主轴流", () => {
		const flow = node("box", { height: 1 })
		const overlay = node("box", { position: "absolute", top: 0, left: 0, width: 1, height: 1 })
		layout(node("box", {}, [overlay, flow]), 10, 5)
		expect(flow.layout.y).toBe(0)
	})

	test("absolute 只给 right/bottom 时贴右下", () => {
		const overlay = node("box", { position: "absolute", right: 1, bottom: 1, width: 2, height: 1 })
		layout(node("box", {}, [overlay]), 10, 5)
		expect(overlay.layout).toEqual({ x: 7, y: 3, width: 2, height: 1 })
	})
})

describe("布局引擎：取整与反向（R2/R4）", () => {
	test("flexGrow 非整除分配取整，坐标保持整数", () => {
		const a = node("box", { width: 1, height: 1, flexGrow: 1 })
		const b = node("box", { width: 1, height: 1, flexGrow: 1 })
		const root = layout(node("box", { flexDirection: "row" }, [a, b]), 9, 1)
		// free = 9 - 2 = 7 → 每项 floor(1 + 3.5) = 4，末尾留 1 格
		expect(a.layout).toEqual({ x: 0, y: 0, width: 4, height: 1 })
		expect(b.layout).toEqual({ x: 4, y: 0, width: 4, height: 1 })
		for (const entry of dumpLayout(root)) {
			expect(Number.isInteger(entry.rect.x)).toBe(true)
			expect(Number.isInteger(entry.rect.y)).toBe(true)
		}
	})

	test("justifyContent space-between 非整除间距取整", () => {
		const a = node("box", { width: 1, height: 1 })
		const b = node("box", { width: 1, height: 1 })
		const c = node("box", { width: 1, height: 1 })
		layout(node("box", { flexDirection: "row", justifyContent: "space-between" }, [a, b, c]), 10, 1)
		expect([a.layout.x, b.layout.x, c.layout.x]).toEqual([0, 4, 9])
	})

	test("row-reverse 只镜像流内子项，absolute 子项按 inset 不动", () => {
		const flow = node("box", { width: 2, height: 1 })
		const overlay = node("box", { position: "absolute", top: 0, left: 1, width: 2, height: 1 })
		layout(node("box", { flexDirection: "row-reverse" }, [flow, overlay]), 10, 1)
		// 流内子项镜像：x = 10 - 0 - 2 = 8
		expect(flow.layout.x).toBe(8)
		// absolute 子项不镜像
		expect(overlay.layout.x).toBe(1)
	})
})

describe("布局引擎：属性归一化", () => {
	test("direction 兼容 flexDirection", () => {
		expect(readStyle({ direction: "row" }).flexDirection).toBe("row")
		expect(readStyle({ flexDirection: "row-reverse" }).flexDirection).toBe("row-reverse")
	})

	test("border 数组按边生效", () => {
		const style = readStyle({ border: ["left", "right"] })
		expect(style.border).toEqual({ top: 0, right: 1, bottom: 0, left: 1 })
	})

	test("paddingX/paddingY 覆盖单边", () => {
		const style = readStyle({ padding: 1, paddingX: 2 })
		expect(style.padding.left).toBe(2)
		expect(style.padding.right).toBe(2)
		expect(style.padding.top).toBe(1)
	})

	test("gap 同时作为行列间距，rowGap 可覆盖", () => {
		expect(readStyle({ gap: 2 }).rowGap).toBe(2)
		expect(readStyle({ gap: 2, rowGap: 0 }).rowGap).toBe(0)
	})
})
