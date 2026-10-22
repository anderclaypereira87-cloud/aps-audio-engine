import onnx,numpy as np
from onnx import numpy_helper,helper
m=onnx.load('htdemucs_6s.onnx');print('opset',[o.version for o in m.opset_import])
g=m.graph;new=[];nodes=[];cnt=0;
for init in list(g.initializer):
  a=numpy_helper.to_array(init)
  if a.dtype!=np.float32 or a.size<4096: new.append(init);continue
  ax=0 if a.ndim>1 else None
  if ax is None: s=np.array(np.abs(a).max()/127+1e-12,dtype=np.float32); q=np.round(a/s)
  else:
    s=(np.abs(a.reshape(a.shape[0],-1)).max(1)/127+1e-12).astype(np.float32); q=np.round(a/s.reshape([-1]+[1]*(a.ndim-1)))
  q=np.clip(q,-127,127).astype(np.int8)
  n=init.name
  new+= [numpy_helper.from_array(q,n+'_q'),numpy_helper.from_array(s,n+'_s')]
  att={'axis':0} if ax is not None else {}
  nodes.append(helper.make_node('DequantizeLinear',[n+'_q',n+'_s'],[n],**att));cnt+=1
del g.initializer[:];g.initializer.extend(new)
old=list(g.node);del g.node[:];g.node.extend(nodes+old)
onnx.save(m,'htdemucs_6s_int8w.onnx');print('quantized',cnt)
