import {createContext} from 'react';

// Let a nested editor request its approved page chrome without owning navigation or business state.
export const GatheringNicknameChrome=createContext<((active:boolean)=>void)|null>(null);
