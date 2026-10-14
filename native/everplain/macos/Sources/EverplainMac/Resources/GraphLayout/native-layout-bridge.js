/* Host timer callbacks are intentionally not scheduled: every requested layout is synchronous
 * (animate:false), and the native view owns all rendering. cy.destroy() ends the animation loop. */
var __nativeTimerId = 0;
var setTimeout = function () { return ++__nativeTimerId; };
var clearTimeout = function () {};
var console = { log:function(){}, warn:function(){}, error:function(){} };
var __nativePalette = {};
function graphColor(token, percent) {
  var color = __nativePalette[token];
  if (!color || color.length !== 4) throw new Error('Missing graph palette token: ' + token);
  return 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + color[3] * (percent === undefined ? 1 : percent / 100) + ')';
}
function __nativeGraphLayout(encoded) {
  var input = JSON.parse(encoded);
  __nativePalette = input.palette;
  if (!input.nodes.length) return JSON.stringify({algorithm:'empty',nodes:[],edges:[],zoom:1,pan:{x:input.width/2,y:input.height/2}});
  var style = workspaceGraphStyle();
  if (input.personal) style = style.concat([
    {selector:'node.node--self',style:{width:70,height:70,'background-opacity':0,'border-width':0,'text-margin-y':-5}},
    {selector:'node.node--topic',style:{width:18,height:18,'background-color':graphColor('faint'),'font-size':12}},
    {selector:'node.node--knowledge',style:{width:6,height:6,'background-color':graphColor('faint'),'font-size':9}}
  ]);
  var cy = cytoscape({headless:true,styleEnabled:true,autoungrabify:false,boxSelectionEnabled:false,elements:graphElements(input,input.focusNodeId),style:style,layout:{name:'preset'},maxZoom:3.2,minZoom:0.16});
  var actualContainer = cy.container;
  try {
    var options = layoutOptions(Boolean(input.focusNodeId),input.edges.length>0,false,560,input.personal);
    // Supply the browser container dimensions without a DOM. Do NOT set boundingBox:
    // COSE treats an explicit boundingBox as a request to rescale final positions.
    cy.width = function () { return input.width; };
    cy.height = function () { return input.height; };
    cy.layout(options).run();
    cy.container = function () { return {clientWidth:input.width,clientHeight:input.height}; };
    fitView(cy,input.focusNodeId,false);
    function n(element,name,fallback) { var p = element.pstyle(name), value=p && (p.pfValue===undefined?p.value:p.pfValue); return typeof value==='number' && Number.isFinite(value)?value:fallback; }
    function c(element,name) { var v=element.pstyle(name).value; return {red:v[0]/255,green:v[1]/255,blue:v[2]/255,alpha:v.length>3?v[3]:1}; }
    var result = {algorithm:options.name,zoom:cy.zoom(),pan:cy.pan(),nodes:cy.nodes().map(function(node){
      var position=node.position();
      if(!Number.isFinite(position.x)||!Number.isFinite(position.y)) throw new Error('Non-finite graph position');
      return {id:node.id(),x:position.x,y:position.y,width:n(node,'width',10),height:n(node,'height',10),borderWidth:n(node,'border-width',0),opacity:n(node,'opacity',1),backgroundOpacity:n(node,'background-opacity',1),textOpacity:n(node,'text-opacity',1),fontSize:n(node,'font-size',10),fontWeight:String(node.pstyle('font-weight').value),textMarginY:n(node,'text-margin-y',-8),minZoomedFontSize:n(node,'min-zoomed-font-size',8),outlineWidth:n(node,'text-outline-width',0),outlineOpacity:n(node,'text-outline-opacity',0),underlayOpacity:n(node,'underlay-opacity',0),underlayPadding:n(node,'underlay-padding',0),background:c(node,'background-color'),border:c(node,'border-color'),ink:c(node,'color'),outline:c(node,'text-outline-color'),underlay:c(node,'underlay-color')};
    }),edges:cy.edges().map(function(edge){
      var width=n(edge,'width',.8),arrowScale=n(edge,'arrow-scale',1);
      return {id:edge.id(),label:edge.data('label'),width:width,opacity:n(edge,'opacity',1),dashed:edge.pstyle('line-style').value==='dashed',color:c(edge,'line-color'),sourceArrowColor:c(edge,'source-arrow-color'),targetArrowColor:c(edge,'target-arrow-color'),sourceArrow:edge.pstyle('source-arrow-shape').value==='triangle',targetArrow:edge.pstyle('target-arrow-shape').value==='triangle',arrowSize:Math.max(Math.pow(width*13.37,.9),29)*arrowScale};
    })};
    return JSON.stringify(result);
  } finally { cy.container=actualContainer; cy.destroy(); }
}
