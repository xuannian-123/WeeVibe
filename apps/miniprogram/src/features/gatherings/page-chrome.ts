import {createContext,useContext,useEffect} from 'react';

// Let a nested editor request its approved page chrome without owning navigation or business state.
export const GatheringDesignChrome=createContext<((screen:'nickname'|'plan'|'result'|'interview'|'form'|null)=>void)|null>(null);
export function useGatheringFormChrome(active=true){
  const chrome=useContext(GatheringDesignChrome);
  useEffect(()=>{if(!active)return;chrome?.('form');return()=>chrome?.(null);},[chrome,active]);
}
