import {useEffect,useState} from "react";
import type {Language} from "../../shared/contracts";
import type {PilotCard,RecommendedQueue} from "../../../contracts/learning-pilot";
import {apiFetch} from "../../shared/api";
import {practiceSet} from "./practiceSet";
import {useRecommendationRefresh} from "./useRecommendationRefresh";
const emptyItems: PilotCard[] = [];
export function useListenRecommendations(language:Language,setValue:string,count:string,enabled:boolean,revision:number,profileId:string) {
  const [retryCount,setRetryCount]=useState(0);
  const [state,setState]=useState<{key:string;result?:RecommendedQueue;error?:string} | null>(null);
  const key=JSON.stringify([profileId,language,setValue,count,enabled,revision,retryCount]);
  const current=state?.key===key ? state : null;
  const loading=enabled && !current;
  const error=current?.error ?? "";
  const recommendation=current?.result?.recommendation ?? null;
  const retry=()=>setRetryCount((value)=>value+1);
  useRecommendationRefresh(recommendation,enabled,()=>{if(!loading)retry();});
  useEffect(()=>{
    if(!enabled) {setState(null);return;}
    const controller=new AbortController();
    const params=new URLSearchParams({language,limit:count});
    const scope=practiceSet(setValue);
    if(scope.kind!=="all") params.set(scope.kind==="category"?"categoryId":"topicId",scope.kind==="liked"?"liked":scope.id);
    void apiFetch(`/api/pilot/listen-queue?${params}`,{signal:controller.signal,headers:{"X-Rehearsal-Profile":profileId}}).then(async(response)=>{
      if(!response.ok) throw new Error("Could not load recommendations.");
      const result=await response.json() as RecommendedQueue;if(!controller.signal.aborted)setState({key,result});
    }).catch(()=>{if(!controller.signal.aborted)setState({key,error:"Could not load recommendations. Retry to continue."});});
    return ()=>controller.abort();
  },[key]);
  return {items:current?.result?.items ?? emptyItems,recommendation,error,loading,retry};
}
