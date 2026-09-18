import {useEffect,useState} from "react";
import type {Language,LearningItem} from "../../shared/contracts";
import {apiFetch} from "../../shared/api";
import {practiceSet} from "./practiceSet";
export function useListenRecommendations(language:Language,setValue:string,count:string,enabled:boolean,revision:number) {
  const [items,setItems]=useState<LearningItem[]>([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(enabled);
  const [retryCount,setRetryCount]=useState(0);
  useEffect(()=>{
    if(!enabled) return;
    const controller=new AbortController();setLoading(true);setError("");setItems([]);
    const params=new URLSearchParams({language,limit:count==="all"?"20":count});
    const scope=practiceSet(setValue);
    if(scope.kind!=="all") params.set(scope.kind==="category"?"categoryId":"topicId",scope.kind==="liked"?"liked":scope.id);
    void apiFetch(`/api/pilot/listen-queue?${params}`,{signal:controller.signal}).then(async(response)=>{
      if(!response.ok) throw new Error("Could not load recommendations.");
      const result=await response.json();if(!controller.signal.aborted)setItems(result.items);
    }).catch(()=>{if(!controller.signal.aborted)setError("Could not load recommendations. Retry to continue.");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[language,setValue,count,enabled,revision,retryCount]);
  return {items,error,loading,retry:()=>setRetryCount((value)=>value+1)};
}
