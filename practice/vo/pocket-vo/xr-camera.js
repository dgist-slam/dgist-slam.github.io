/* WebXR raw images and their own projection, never getUserMedia intrinsics. */
(function(root){
function fromProjection(p,width,height){
 if(!p||p.length!==16||!Array.from(p).every(Number.isFinite)||p[0]<=0||p[5]<=0||Math.abs(p[1])>1e-5||Math.abs(p[11]+1)>1e-4)throw Error('Unsupported XR projection');
 return {fx:p[0]*width/2,fy:p[5]*height/2,cx:(1-p[8])*width/2-.5,cy:(1+p[9])*height/2-.5,skew:-p[4]*width/2,width,height,source:'WebXR'};
}
class XRCameraSource {
 constructor({onFrame,onEnd,onStatus,canProcess}){Object.assign(this,{onFrame,onEnd,onStatus,canProcess});this.session=null;this.cancelled=false;}
 async start(overlay){
  const session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['camera-access','dom-overlay'],domOverlay:{root:overlay}});
  this.session=session;
  if(this.cancelled){await session.end();return;}
  session.addEventListener('end',()=>{this.session=null;this.cleanup();if(!this.silentEnd)this.onEnd();},{once:true});
  try{
   this.canvas=document.createElement('canvas');const gl=this.gl=this.canvas.getContext('webgl',{xrCompatible:true,alpha:true,antialias:false});
   if(!gl)throw Error('WebGL unavailable');await gl.makeXRCompatible();
   if(this.cancelled||!this.session)return;
   this.binding=new XRWebGLBinding(session,gl);this.layer=new XRWebGLLayer(session,gl,{alpha:true,antialias:false});session.updateRenderState({baseLayer:this.layer});
   this.space=await session.requestReferenceSpace('local');if(this.cancelled||!this.session)return;
   this.initGL();this.onStatus('AR 카메라 준비 · 실제 내부 파라미터 수신 대기');session.requestAnimationFrame((t,f)=>this.frame(t,f));
  }catch(e){this.silentEnd=true;await this.stop();throw e;}
 }
 initGL(){const gl=this.gl;function shader(type,source){let s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  let vs=shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){gl_Position=vec4(p,0.,1.);uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);}'),fs=shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform sampler2D camera;varying vec2 uv;void main(){gl_FragColor=texture2D(camera,uv);}');
  this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error('XR image shader failed');
  this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);this.framebuffer=gl.createFramebuffer();this.output=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.output);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 }
 frame(time,frame){if(!this.session||this.cancelled)return;this.session.requestAnimationFrame((t,f)=>this.frame(t,f));const gl=this.gl;
  try{gl.bindFramebuffer(gl.FRAMEBUFFER,this.layer.framebuffer);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);if(!this.canProcess()||time-(this.lastTime||0)<33)return;
   const pose=frame.getViewerPose(this.space),view=pose?.views.find(v=>v.camera);if(!view){this.onStatus('AR 추적 / 카메라 영상 대기');return;}const camera=view.camera,texture=this.binding.getCameraImage(camera);if(!texture)return;
   let width=384,height=Math.round(width*camera.height/camera.width),K=fromProjection(view.projectionMatrix,width,height);
   if(width!==this.width||height!==this.height){this.width=width;this.height=height;gl.bindTexture(gl.TEXTURE_2D,this.output);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);this.pixels=new Uint8Array(width*height*4);}
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.output,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('XR readback framebuffer incomplete');
   gl.viewport(0,0,width,height);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);let loc=gl.getAttribLocation(this.program,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(this.program,'camera'),0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,this.pixels);if(gl.getError()!==gl.NO_ERROR)throw Error('XR camera image readback failed');
   this.lastTime=time;this.onFrame(new Uint8ClampedArray(this.pixels),width,height,K,{width:camera.width,height:camera.height});
  }catch(e){this.silentEnd=true;this.stop().then(()=>this.onEnd('AR 오류: '+e.message));}
 }
 async stop(){this.cancelled=true;const s=this.session;if(s){try{await s.end();}catch{this.session=null;this.cleanup();}}else this.cleanup();}
 cleanup(){const gl=this.gl;if(!gl)return;gl.deleteBuffer(this.buffer);gl.deleteFramebuffer(this.framebuffer);gl.deleteTexture(this.output);gl.deleteProgram(this.program);this.gl=null;}
}
root.PocketXRCamera={fromProjection,XRCameraSource};if(typeof module!=='undefined')module.exports=root.PocketXRCamera;
})(globalThis);
