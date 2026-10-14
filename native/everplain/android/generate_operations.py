"""Generate native JSON operations only from the shared exact backend contract.
Streaming, multipart and binary operations are explicitly reported separately.
No mock data, origin, credentials or client-side schema duplicates are generated.
"""
import json,pathlib,re,hashlib
root=pathlib.Path(__file__).resolve().parent
path=root.parent/'contracts/openapi.native.json'; doc=json.loads(path.read_text())

def camel(s):
 return re.sub(r'_([a-z])',lambda m:m[1].upper(),s)
def shape(s):
 if '$ref' in s:return s['$ref'].split('/')[-1]
 if 'anyOf' in s:
  choices=[x for x in s['anyOf'] if x.get('type')!='null']; return shape(choices[0])+'?' if len(choices)==1 else 'JsonElement'
 t=s.get('type');return {'string':'String','integer':'Long','number':'Double','boolean':'Boolean','object':'JsonObject'}.get(t,'List<'+shape(s.get('items',{}))+'>' if t=='array' else 'JsonElement')
def serializer(typ):
 if typ.endswith('?'):return serializer(typ[:-1])+'.nullable'
 if typ.startswith('List<'):return 'ListSerializer('+serializer(typ[5:-1])+')'
 return typ+'.serializer()'
lines=['// Generated from shared OpenAPI SHA256 '+hashlib.sha256(path.read_bytes()).hexdigest(),
'package app.everplain.core','','import app.everplain.shared.*','import kotlinx.serialization.builtins.*','import kotlinx.serialization.json.*','','/** Exact JSON operations. All writes require an explicit, caller-owned intent key. */','class NativeOperations(private val api: EverplainApi) {']
included=[];excluded=[]
for route,ops in doc['paths'].items():
 for method,o in ops.items():
  if method not in ('get','post','put','patch','delete'):continue
  name=camel(o['operationId'])
  if name == 'getResearchMaterialContent':
   excluded.append([name,'authenticated binary media with Range/206 support']);continue
  if name == 'stopAgentRun':
   excluded.append([name,'EverplainApi.stop distinguishes 202/204 from confirmed terminal status']);continue
  if name == 'getImportImageAsset':
   excluded.append([name,'binary image response verified in backend knowledge_import.get_asset']);continue
  content=o.get('requestBody',{}).get('content',{})
  if content and 'application/json' not in content:excluded.append([name,'multipart request']);continue
  responses=[v for k,v in sorted(o.get('responses',{}).items()) if k.startswith('2')]
  jsonresponse=next((x['content']['application/json']['schema'] for x in responses if 'application/json' in x.get('content',{})),None)
  if jsonresponse is None and any(x.get('content') for x in responses): excluded.append([name,'streaming or binary response']);continue
  rettype=shape(jsonresponse) if jsonresponse is not None else 'Unit'
  params=[];pmap=[];qmap=[];key='null'
  for p in o.get('parameters',[]):
   if p['in']=='header':
    if p['name']=='Idempotency-Key':params.append('key: String');key='key'
    else:raise Exception('unhandled header '+str(p))
    continue
   n=camel(p['name']);typ=shape(p['schema']); required=p.get('required',False)
   if not required and not typ.endswith('?'):typ+='?'
   params.append(f'{n}: {typ}'+('' if required else ' = null'))
   if p['in']=='path':pmap.append(json.dumps(p['name'])+' to '+n)
   elif p['in']=='query':qmap.append(json.dumps(p['name'])+' to '+(f'{n}?.map {{ it.toString() }}' if typ.startswith('List<') and typ.endswith('?') else f'{n}.map {{ it.toString() }}' if typ.startswith('List<') else f'{n}?.let {{ listOf(it.toString()) }}' if typ.endswith('?') else f'listOf({n}.toString())'))
   else:raise Exception('unhandled parameter')
  body='null'
  if content:
   typ=shape(content['application/json']['schema']); required=o['requestBody'].get('required',False)
   if not required and not typ.endswith('?'):typ+='?'
   params.append('body: '+typ+('' if required else ' = null'))
   body=f'WireJson.encodeToString({serializer(typ)}, body)'
  route_expr='contractPath('+json.dumps(route)+', mapOf('+', '.join(pmap)+'))' if pmap else json.dumps(route)
  query='mapOf('+', '.join(qmap)+')' if qmap else 'emptyMap()'
  fn='contractUnit' if rettype=='Unit' else 'contractJson'
  args=([serializer(rettype)] if rettype!='Unit' else [])+[route_expr,json.dumps(method.upper()),body,key,query]
  lines+=['',f'    suspend fun {name}('+', '.join(params)+f'): {rettype} =',f'        api.{fn}('+', '.join(args)+')']
  included.append(name)
lines+=['}','','internal fun contractPath(template: String, parameters: Map<String, String>): String {','    var path = template','    parameters.forEach { (name, value) ->','        val encoded = okhttp3.HttpUrl.Builder().scheme("https").host("path.invalid").addPathSegment(value).build().encodedPath.removePrefix("/")','        path = path.replace("{$name}", encoded)','    }','    return path','}']
(root/'core/src/main/kotlin/app/everplain/core/NativeOperations.kt').write_text('\n'.join(lines)+'\n')
(root/'verification/operation-coverage.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'jsonOperations':included,'requiresSpecializedTransport':excluded},indent=2)+'\n')
print(len(included),'JSON operations;',len(excluded),'specialized transports')
