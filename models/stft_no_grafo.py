import onnx,numpy as np
from onnx import numpy_helper,helper,TensorProto
m=onnx.load('htdemucs_6s_int8w.onnx');g=m.graph
N=4096
spec={'/real_stft/Constant_14_output_0':('Cos',None),'/real_stft/Constant_15_output_0':('Sin',None),
'/real_istft/Constant_7_output_0':('Cos','istft'),'/real_istft/Constant_8_output_0':('Sin','istft')}
# scales
hann=(0.5-0.5*np.cos(2*np.pi*np.arange(N)/N)).astype(np.float32)
row_stft=np.full(2049,0.015625,np.float32)
row_istft=np.full(2049,0.03125,np.float32);row_istft[0]=row_istft[-1]=0.015625
signs={'/real_stft/Constant_15_output_0':-1,'/real_istft/Constant_8_output_0':-1}
inits=[numpy_helper.from_array(np.arange(2049,dtype=np.int32).reshape(2049,1,1),'aps_k'),
numpy_helper.from_array(np.arange(N,dtype=np.int32).reshape(1,1,N),'aps_t'),
numpy_helper.from_array(np.array(N,dtype=np.int32),'aps_N'),
numpy_helper.from_array(np.array(2*np.pi/N,dtype=np.float32),'aps_w'),
numpy_helper.from_array(hann.reshape(1,1,N),'aps_hann')]
pre=[helper.make_node('Mul',['aps_k','aps_t'],['aps_kt']),helper.make_node('Mod',['aps_kt','aps_N'],['aps_m'],fmod=0),
helper.make_node('Cast',['aps_m'],['aps_mf'],to=TensorProto.FLOAT),helper.make_node('Mul',['aps_mf','aps_w'],['aps_arg']),
helper.make_node('Cos',['aps_arg'],['aps_cos']),helper.make_node('Sin',['aps_arg'],['aps_sin'])]
for name,(op,kind) in spec.items():
  row=(row_istft if kind else row_stft)*signs.get(name,1)
  rn=name.replace('/','_')+'_row';inits.append(numpy_helper.from_array((row.reshape(2049,1,1)).astype(np.float32),rn))
  pre+=[helper.make_node('Mul',['aps_'+op.lower(),'aps_hann'],[rn+'_h']),helper.make_node('Mul',[rn+'_h',rn],[name])]
keep=[n for n in g.node if not(n.op_type=='Constant' and n.output[0] in spec)]
del g.node[:];g.node.extend(pre+keep);g.initializer.extend(inits)
onnx.save(m,'htdemucs_6s_leve.onnx')
