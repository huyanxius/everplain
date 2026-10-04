import cytoscape, { type Core } from 'cytoscape'
import { expect, it, vi } from 'vitest'
import { fitView, layoutOptions } from './graphLayout'
import { positionedElements } from './graphLayoutCache'
it('uses natural relation layout for personal graphs instead of oversized concentric rings', () => {
 expect(layoutOptions(false,true,false,560,true)).toMatchObject({name:'cose',randomize:false})
 const elements=Array.from({length:154},(_,i)=>({data:{id:`node-${i}`}}))
 const edges=elements.slice(1).map((n,i)=>({data:{id:`edge-${i}`,source:i<28?'node-0':`node-${1+(i%26)}`,target:n.data.id}}))
 const cy=cytoscape({headless:true,elements:positionedElements([...elements,...edges]),layout:{name:'preset'}})
 cy.layout({...layoutOptions(false,true,false,560,true),fit:false}).run()
 expect(cy.nodes().every(n=>Number.isFinite(n.position('x')) && Number.isFinite(n.position('y')))).toBe(true)
 expect(cy.nodes().boundingBox().w).toBeLessThan(10000)
 cy.destroy()
})
it.each([[1400,700],[360,640],[1920,1080]])('fits full bounds at %ix%i without the old .16 floor', (width,height) => {
 const viewport=vi.fn()
 const graph={container:()=>({clientWidth:width,clientHeight:height}),nodes:()=>({boundingBox:()=>({x1:-6500,y1:-6500,w:13000,h:13000})}),minZoom:()=>.01,maxZoom:()=>3.2,viewport} as unknown as Core
 fitView(graph)
 const {zoom,pan}=viewport.mock.calls[0][0]
 expect(13000*zoom).toBeLessThanOrEqual(height)
 expect(13000*zoom).toBeLessThanOrEqual(width)
 expect(pan).toEqual({x:width/2,y:height/2})
})
it('defers fitting hidden zero-size containers until a resize',()=>{
 const viewport=vi.fn()
 const graph={container:()=>({clientWidth:0,clientHeight:0}),nodes:()=>({boundingBox:()=>({w:100,h:100})}),viewport} as unknown as Core
 fitView(graph)
 expect(viewport).not.toHaveBeenCalled()
})
