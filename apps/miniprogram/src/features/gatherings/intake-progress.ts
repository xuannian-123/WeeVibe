import {z} from 'zod';
import {gatheringCertaintyBlocks,gatheringIntakeSchema,gatheringPrivateIntakeSchema,type GatheringIntake} from '@weevibe/contracts';

// A local edit can temporarily contain an inverted budget or an unfinished
// numeric entry. Keep its text, then let the normal intake checks validate it.
const draftPrivateSchema=z.object({...gatheringPrivateIntakeSchema.shape,
  budget_min:z.number().nullable(),budget_max:z.number().nullable(),
}).strict();
const draftIntakeSchema=gatheringIntakeSchema.extend({private:draftPrivateSchema});
const questionText=z.record(z.string().regex(/^[0-4]$/),z.string().max(1000));
const publicQuestionText=z.record(z.string().regex(/^[34]$/),z.string().max(1000));
const key=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

const intakeProgressSchema=z.object({
  version:z.literal(1),
  intake:draftIntakeSchema,
  mode:z.enum(['form','interview']),step:z.number().int().min(0).max(5),
  budgetMinText:z.string().max(128),budgetMaxText:z.string().max(128),
  answered:z.array(z.boolean()).length(5),
  noteBase:z.string().max(1000),questionProse:publicQuestionText,
  acknowledgements:questionText,composers:questionText,
  confirm:z.boolean(),selected:z.array(key).max(100),summary:z.string().max(100_000),
}).strict().superRefine((progress,ctx)=>{
  if(progress.mode==='form'&&progress.step>4)ctx.addIssue({code:'custom',message:'填表页码越界'});
  if(new Set(progress.selected).size!==progress.selected.length)ctx.addIssue({code:'custom',message:'确定项重复'});
  if(progress.confirm){
    const checked=gatheringIntakeSchema.safeParse(gatheringProgressIntake(progress));
    if(!checked.success||!checked.data.public.activity_nickname.trim()){
      ctx.addIssue({code:'custom',message:'确认内容尚未有效'});return;
    }
    try{
      const allowed=new Set(gatheringCertaintyBlocks(checked.data).map(block=>block.id));
      if(progress.selected.some(id=>!allowed.has(id)))ctx.addIssue({code:'custom',message:'确定项已无对应内容'});
    }catch{ctx.addIssue({code:'custom',message:'确认内容无法核对'});}
  }
});

/** Only the parent that owns the actor-bound local draft may persist this value. */
export type GatheringIntakeProgress=z.infer<typeof intakeProgressSchema>;
export type GatheringIntakeProgressState=Omit<GatheringIntakeProgress,'version'>;

/** No storage, network, parser advancement or submission happens while reading. */
export function readGatheringIntakeProgress(raw:unknown):GatheringIntakeProgress|undefined{
  const parsed=intakeProgressSchema.safeParse(raw);
  return parsed.success?parsed.data:undefined;
}

/** JSON cannot preserve NaN/Infinity; the raw field text restores them for validation. */
export function makeGatheringIntakeProgress(state:GatheringIntakeProgressState):GatheringIntakeProgress|undefined{
  const value={...state,version:1,intake:{...state.intake,private:{...state.intake.private,
    budget_min:Number.isFinite(state.intake.private.budget_min)?state.intake.private.budget_min:null,
    budget_max:Number.isFinite(state.intake.private.budget_max)?state.intake.private.budget_max:null,
  }}};
  return readGatheringIntakeProgress(value);
}

/** Rebuild temporary invalid numeric edits instead of silently accepting them as blank. */
export function gatheringProgressIntake(progress:Pick<GatheringIntakeProgressState,'intake'|'budgetMinText'|'budgetMaxText'>):GatheringIntake{
  const amount=(text:string)=>text.trim()?Number(text):null;
  return {...progress.intake,private:{...progress.intake.private,budget_min:amount(progress.budgetMinText),budget_max:amount(progress.budgetMaxText)}};
}
