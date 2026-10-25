import assert from 'node:assert/strict';
import test from 'node:test';
import { PodcastSession, PodcastPort, PodcastCourse } from './podcastSession';
import { LearningStore } from '../adapters/wechat/learningStore';
import { ProgressJournal } from '../services/progressJournal';
import { createMemoryKeyValue } from '../test-support/memoryKeyValue';
function setup(resolve = async (id: string) => ({id,title:id,source:`https://example.org/${id}.mp3`})) {
 const loads: PodcastCourse[]=[];const state={positionMs:0,durationMs:100000,playing:false};
 const media:PodcastPort={snapshot:()=>({...state}),load:c=>{loads.push(c);state.positionMs=0;state.playing=true;},play:()=>{state.playing=true;},pause:()=>{state.playing=false;},seek:p=>{state.positionMs=p;}};
 const journal=new ProgressJournal({store:new LearningStore(createMemoryKeyValue())});
 return {session:new PodcastSession(media,journal,resolve,['A','B','C']),loads,state,journal};
}
test('late course responses cannot replace latest selection',async()=>{
 const pending=new Map<string,(c:PodcastCourse)=>void>();const x=setup(id=>new Promise(r=>pending.set(id,r)));
 const jobs=['A','B','C'].map(id=>x.session.open(id));
 for(const id of ['C','A','B']) pending.get(id)!({id,title:id,source:'https://example.org/pb.mp3'});
 await Promise.all(jobs);assert.deepEqual(x.loads.map(c=>c.id),['C']);
});
test('pause during load wins and hide does not stop playback',async()=>{
 const x=setup();await x.session.open('A');x.session.pause();
 await x.session.event('ready',x.session.state().generation);assert.equal(x.state.playing,false);
 x.session.play();x.session.hide();assert.equal(x.state.playing,true);
});
test('natural playback completes and last course wraps to first',async()=>{
 const x=setup();await x.session.open('C');const g=x.session.state().generation;
 await x.session.event('ready',g);x.state.positionMs=96000;await x.session.event('time',g);
 assert.equal(x.journal.readRecord('C').lessonCompleted,true);
 await x.session.event('ended',g);assert.equal(x.session.state().course?.id,'A');
});
test('old media events cannot complete the new course',async()=>{
 const x=setup();await x.session.open('A');const g=x.session.state().generation;
 await x.session.event('ready',g);await x.session.open('B');await x.session.event('ended',g);
 assert.equal(x.journal.readRecord('B').lessonCompleted,false);assert.equal(x.session.state().course?.id,'B');
});
test('seeking to the end does not complete or auto-advance',async()=>{
 const x=setup();await x.session.open('A');const g=x.session.state().generation;
 await x.session.event('ready',g);x.session.seek(100000);
 await x.session.event('time',g);await x.session.event('ended',g);
 assert.equal(x.journal.readRecord('A').lessonCompleted,false);
 assert.equal(x.session.state().course?.id,'A');
});
test('saved position restores after a new session, completed course starts from zero',async()=>{
 const x=setup();x.journal.commit({lessonId:'A',track:'pb',positionMs:42000,durationMs:100000,reason:'userSeek'});
 await x.session.open('A');await x.session.event('ready',x.session.state().generation);
 assert.equal(x.state.positionMs,42000);
 x.journal.commitCompleted('B');await x.session.open('B');await x.session.event('ready',x.session.state().generation);
 assert.equal(x.state.positionMs,0);assert.equal(x.journal.readRecord('B').lessonCompleted,true);
});
test('shared lesson entry waits for a play tap and preserves an already active copy',async()=>{
 const x=setup();
 await x.session.open('A','shareEntry');
 const shareGeneration=x.session.state().generation;
 await x.session.event('ready',shareGeneration);
 assert.equal(x.session.state().wantsPlay,false);
 assert.equal(x.state.playing,false);
 assert.equal(x.state.positionMs,0);

 x.session.play();
 assert.equal(x.state.playing,true);
 const loadsBeforeSameLessonShare=x.loads.length;
 await x.session.open('A','shareEntry');
 assert.equal(x.loads.length,loadsBeforeSameLessonShare);
 assert.equal(x.state.playing,true);
});
test('system pause affects manual navigation intent; confirmed system resume is accepted',async()=>{
 const x=setup();await x.session.open('A');const g=x.session.state().generation;
 await x.session.event('ready',g);x.state.playing=false;await x.session.event('pause',g);
 assert.equal(x.session.state().wantsPlay,false);
 x.state.playing=true;await x.session.event('play',g);assert.equal(x.session.state().wantsPlay,true);
 x.state.playing=false;await x.session.event('pause',g);await x.session.navigate(1);
 await x.session.event('ready',x.session.state().generation);assert.equal(x.state.playing,false);
});
test('failed course request preserves previously saved progress and is recoverable',async()=>{
 let fail=true;const x=setup(async id=>{if(fail)throw Error('network');return {id,title:id,source:'https://example.org/pb.mp3'};});
 await x.session.open('A');assert.ok(x.session.state().error);assert.equal(x.loads.length,0);
 fail=false;await x.session.open('A');await x.session.event('ready',x.session.state().generation);
 assert.equal(x.session.state().error,'');assert.equal(x.state.playing,true);
});
test('playback errors stop the media and do not falsely mark a course complete',async()=>{
 const x=setup();await x.session.open('A');const g=x.session.state().generation;
 await x.session.event('ready',g);await x.session.event('error',g);
 assert.equal(x.state.playing,false);assert.equal(x.session.state().ready,false);
 assert.equal(x.journal.readRecord('A').lessonCompleted,false);
});
