import {z} from 'zod';

// Versioned keys are stored with the activity membership, never derived from a
// global account or picked independently by clients. Keep existing keys stable.
export const gatheringAvatarAnimals=['rabbit','hedgehog','elephant','squirrel','panda','ox','fox','dog','lion','wolf','pig','cat','monkey','sheep','tiger','crab','giraffe','horse','rooster','duck','deer'] as const;
export const gatheringAvatarBackgrounds=['#A7F05A','#B7A4F8','#FF9DAB','#89CDEB','#F5C75D','#FFAF7A','#91D1AC','#F2ADD5','#B6C5ED','#C9D582','#E6A58F','#94C6C4','#CEB4DF','#E1C398','#AEBB88','#E3A6BB','#9CC5DD','#F1CF97','#BDD8B7','#C0B1A5','#CBBEEA','#ADCFCB','#DAAA9D','#B7CC91'] as const;
export const gatheringAvatarKeys=gatheringAvatarAnimals.flatMap(animal=>gatheringAvatarBackgrounds.map((_,index)=>`art-${animal}-${String(index).padStart(2,'0')}`));
export const gatheringAvatarKeySchema=z.string().refine(key=>gatheringAvatarKeys.includes(key),'未知的活动头像');
export function gatheringAvatarParts(key:string|undefined){
  if(!key||!gatheringAvatarKeys.includes(key))return null;
  const [,animal,color]=key.split('-');
  return {animal:animal as typeof gatheringAvatarAnimals[number],background:gatheringAvatarBackgrounds[Number(color)]};
}
