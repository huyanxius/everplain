import cytoscape from 'cytoscape'
import { beforeEach, expect, it } from 'vitest'
import { layoutCacheKey, positionedElements, readLayout, saveLayout } from './graphLayoutCache'
const projection = { releaseId: 'library-a', nodes: [{id:'a',label:'A'},{id:'b',label:'B'}], edges: [{id:'ab',source:'a',target:'b',relationType:'link',direction:'directed'}] }
beforeEach(() => localStorage.clear())
it('keys same topology independently of fetch order, labels and focus; invalidates new nodes/edges/scope', () => {
 const key = layoutCacheKey(projection, 'workspace')
 expect(layoutCacheKey({...projection,nodes:[...projection.nodes].reverse()}, 'workspace')).toBe(key)
 expect(layoutCacheKey({...projection,nodes:[...projection.nodes,{id:'c',label:'C'}]}, 'workspace')).not.toBe(key)
 expect(layoutCacheKey({...projection,edges:[]}, 'workspace')).not.toBe(key)
 expect(layoutCacheKey(projection, 'personal')).not.toBe(key)
})
it('persists coordinates across remount and validates exact node identities and finite values', () => {
 const key=layoutCacheKey(projection,'workspace')
 const cy=cytoscape({headless:true,elements:positionedElements(projection.nodes.map(n=>({data:n}))),layout:{name:'preset'}})
 saveLayout(key,cy)
 const restored=readLayout(key,['a','b'])
 expect(restored?.a).toEqual(cy.getElementById('a').position())
 expect(readLayout(key,['a','c'])).toBeUndefined()
 localStorage.setItem(key,JSON.stringify({positions:{a:{x:null,y:1},b:{x:1,y:1}}}))
 expect(readLayout(key,['a','b'])).toBeUndefined()
 cy.destroy()
})
it('seeds non-overlapping geometry deterministically regardless of API ordering', () => {
 const elements=projection.nodes.map(n=>({data:n}))
 expect(positionedElements(elements)).toEqual(positionedElements([...elements].reverse()))
 expect(positionedElements(elements)[0].position).not.toEqual(positionedElements(elements)[1].position)
})
it('tolerates corrupt/unavailable storage', () => {
 localStorage.setItem('bad','{')
 expect(readLayout('bad',['a'])).toBeUndefined()
})
