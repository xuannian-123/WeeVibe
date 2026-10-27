import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import type { RequirementSnapshot } from '@weevibe/contracts';
import safeFallback from '../../assets/share-safe.png';
import { publicAvatarFileName, validatePublicOrganizerAvatar } from './public-avatar';
import { requirementShareSummary } from './share-summary';
export const REQUIREMENT_SHARE_CANVAS = 'requirement-public-share';
export function useRequirementShareImage(snapshot: RequirementSnapshot | undefined) {
  const [image,setImage]=useState<string>(safeFallback);
  const summary=snapshot?requirementShareSummary(snapshot):undefined;
  const publicAvatar=validatePublicOrganizerAvatar(snapshot?.collection.organizer_avatar);
  const fingerprint=JSON.stringify([summary,publicAvatar?.digest]);
  useEffect(()=>{
    let alive=true;let publicAvatarPath='';
    const cleanup=()=>{if(publicAvatarPath){try{Taro.getFileSystemManager().unlinkSync(publicAvatarPath);}catch{}publicAvatarPath='';}};
    setImage(safeFallback);if(!summary)return()=>{alive=false;};
    Taro.nextTick(()=>{
      if(!alive)return;
      try {
        if(publicAvatar){try{publicAvatarPath=`${Taro.env.USER_DATA_PATH}/${publicAvatarFileName(publicAvatar)}`;Taro.getFileSystemManager().writeFileSync(publicAvatarPath,publicAvatar.base64,'base64');}catch{publicAvatarPath='';}}
        const context=Taro.createCanvasContext(REQUIREMENT_SHARE_CANVAS);
        context.setFillStyle('#fff9f3');context.fillRect(0,0,500,400);
        context.setFillStyle('#e8f5ed');context.fillRect(20,20,460,360);
        const line=(text:string,x:number,y:number,size:number,color:string,max:number)=>{context.setFillStyle(color);context.setFontSize(size);context.fillText(text.length>max?text.slice(0,max-1)+'…':text,x,y);};
        line('WeeVibe  ·  '+summary.kind,40,58,17,'#6e8a79',28);
        line(summary.title,40,109,27,'#1d2630',16);
        line(summary.description || '一起说说对这次相聚的期待。',40,151,15,'#737b81',28);
        line('计划时间  '+summary.date.replace('（北京时间 UTC+8）',''),40,207,16,'#4f6069',32);
        line('需求截止  '+summary.deadline.replace('（北京时间 UTC+8）',''),40,245,16,'#4f6069',32);
        line('北京时间 UTC+8 · 未定案前仅为计划',40,271,12,'#88918f',36);
        if(publicAvatarPath){context.save();context.beginPath();context.arc(60,319,22,0,2*Math.PI);context.clip();context.drawImage(publicAvatarPath,38,297,44,44);context.restore();}
        line('发起人  '+summary.organizer,publicAvatarPath?94:40,322,17,'#52665b',publicAvatarPath?23:27);
        line('摘要以进入后的最新状态为准',40,351,12,'#89948d',30);
        context.draw(false,()=>{void Taro.canvasToTempFilePath({canvasId:REQUIREMENT_SHARE_CANVAS,width:500,height:400,destWidth:1000,destHeight:800,fileType:'png'}).then(result=>{if(alive)setImage(result.tempFilePath);cleanup();}).catch(()=>{/* Explicit safe package image; never fall back to a page screenshot. */cleanup();});});
      } catch {/* Unsupported canvas still shares the safe package image. */}
    });
    return()=>{alive=false;cleanup();};
  // Only the allowlisted public summary affects this canvas.
  },[fingerprint]);
  return image;
}
