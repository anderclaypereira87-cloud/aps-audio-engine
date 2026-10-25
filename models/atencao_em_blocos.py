# APS: reescreve as atenções do HTDemucs-6s (Q·Kᵀ → Softmax → ·V) em blocos de consultas.
# Matematicamente igual (softmax é por linha), mas a matriz de atenção 8×2688×2688 (231 MB, ×2 com o softmax)
# vira blocos de CHUNK linhas. Também troca as matrizes da STFT geradas no grafo por entradas (opcional).
# Uso: python3 atencao_em_blocos.py entrada.onnx saida.onnx CHUNK [--stft-entradas]
import sys,onnx,numpy as np
from onnx import helper,numpy_helper,TensorProto
src,dst,CH=sys.argv[1],sys.argv[2],int(sys.argv[3]);ext='--stft-entradas' in sys.argv
m=onnx.load(src);g=m.graph
if ext:
    T={'/real_stft/Constant_14_output_0':'stft_cos','/real_stft/Constant_15_output_0':'stft_sin','/real_istft/Constant_7_output_0':'istft_cos','/real_istft/Constant_8_output_0':'istft_sin'}
    keep=[n for n in g.node if not any(o.startswith(('aps_','_real_')) or o in T for o in n.output)];del g.node[:];g.node.extend(keep)
    ini=[i for i in g.initializer if not i.name.startswith(('aps_','_real_'))];del g.initializer[:];g.initializer.extend(ini)
    for n in g.node:
        for i,x in enumerate(n.input):
            if x in T:n.input[i]=T[x]
    for v in T.values():g.input.append(helper.make_tensor_value_info(v,TensorProto.FLOAT,[2049,1,4096]))
prod={o:n for n in g.node for o in n.output};cons={}
for n in g.node:
    for i in n.input:cons.setdefault(i,[]).append(n)
LQ={}  # comprimento das consultas: camadas "layers" (freq) 2688, "layers_t" (tempo) 1344
new=[];rm=set();cnt=0
for sm in [n for n in g.node if n.op_type=='Softmax']:
    mm1=prod[sm.input[0]];mm2=cons[sm.output[0]][0];assert mm1.op_type=='MatMul' and mm2.op_type=='MatMul'
    q,kt=mm1.input;v=mm2.input[1];lq=1344 if 'layers_t.' in sm.name else 2688
    if '/cross_attn/' in sm.name: lq=1344 if 'layers_t.' in sm.name else 2688
    k=lq//CH;sizes=numpy_helper.from_array(np.array([CH]*k+([lq-CH*k] if lq%CH else []),np.int64),sm.name+'_aps_split')
    g.initializer.append(sizes);parts=[f'{sm.name}_q{i}' for i in range(len(sizes.int64_data) or len(numpy_helper.to_array(sizes)))]
    new.append(helper.make_node('Split',[q,sizes.name],parts,axis=1))
    outs=[]
    for i,p in enumerate(parts):
        s,pr,o=f'{p}_s',f'{p}_p',f'{p}_o'
        new+=[helper.make_node('MatMul',[p,kt],[s]),helper.make_node('Softmax',[s],[pr],axis=-1),helper.make_node('MatMul',[pr,v],[o])];outs.append(o)
    new.append(helper.make_node('Concat',outs,[mm2.output[0]],axis=1))
    rm|={id(mm1),id(sm),id(mm2)};cnt+=1
nodes=[]
for n in g.node:
    if id(n) in rm:
        if n.op_type=='MatMul' and n.output[0] in [x.output[0] for x in new if x.op_type=='Concat']:pass
        continue
    nodes.append(n)
# insere os novos nós no lugar do MatMul final (ordem topológica): basta acrescentar e ordenar
del g.node[:];g.node.extend(nodes+new)
# ordenação topológica simples
avail=set(i.name for i in g.input)|set(i.name for i in g.initializer)|{''};order=[];pend=list(g.node)
while pend:
    rest=[]
    for n in pend:
        if all(x in avail for x in n.input):order.append(n);avail|=set(n.output)
        else:rest.append(n)
    if len(rest)==len(pend):raise SystemExit('ciclo/entrada faltando')
    pend=rest
del g.node[:];g.node.extend(order);onnx.save(m,dst);print('atenções reescritas:',cnt,'bloco',CH)
