# APS: converte para float32 os tensores double (float64) do iSTFT do grafo (ConstantOfShape/Constant/initializers),
# porque o onnxruntime-web recente (1.30) não implementa ConstantOfShape(double). Uso: python3 sem_double.py in.onnx out.onnx
import sys,onnx,numpy as np
from onnx import numpy_helper,TensorProto
m=onnx.load(sys.argv[1]);g=m.graph;k=0
for n in g.node:
    for a in n.attribute:
        if a.type==onnx.AttributeProto.TENSOR and a.t.data_type==TensorProto.DOUBLE:
            arr=numpy_helper.to_array(a.t).astype(np.float32);a.t.CopyFrom(numpy_helper.from_array(arr,a.t.name));k+=1
        if n.op_type=='Cast' and a.name=='to' and a.i==TensorProto.DOUBLE:a.i=TensorProto.FLOAT;k+=1
for i in list(g.initializer):
    if i.data_type==TensorProto.DOUBLE:i.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(i).astype(np.float32),i.name));k+=1
onnx.save(m,sys.argv[2]);print('tensores double convertidos:',k)
