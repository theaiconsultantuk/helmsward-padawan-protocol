// CodexBWAI: both live drafting prompts must carry the storefront signature; catalogue refusal must not contradict itself.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as prompts from '../src/prompts.mjs';
import {frame} from '../src/adapters/sample.mjs';
import {runMessage,msg} from './helpers/route_run.mjs';
test('live reply and recommendation prompts require the same Farstrand sign-off as sample replies',()=>{
 for(const system of [prompts.DRAFTER_SYSTEM,prompts.RECOMMENDATION_SYSTEM,prompts.draftMessages({})[0].content,prompts.recommendationMessages({})[0].content]){
  assert.match(system,/Farstrand Support team/);assert.match(system,/Never sign as Jedi Pack/);
 }
 assert.ok(frame({sender_name:'A'},'x',{team:'Sales'}).endsWith(prompts.signOff('Sales')));
});
test('unanswered catalogue row explains the missing field without denying the product exists',async()=>{
 const {result}=await runMessage(msg('Is the Wayfarer Long Cloak waterproof?','contact-form'));
 assert.match(result.output.reasons.join(' '),/but no field of its row answers what was asked/);
 assert.doesNotMatch(result.output.reasons.join(' '),/not in the catalogue row:/);
});
