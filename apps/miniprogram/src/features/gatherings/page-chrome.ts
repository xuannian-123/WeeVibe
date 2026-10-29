import {createContext} from 'react';

// Let a nested editor request its approved page chrome without owning navigation or business state.
export const GatheringDesignChrome=createContext<((screen:'nickname'|'plan'|'result'|'interview'|null)=>void)|null>(null);
