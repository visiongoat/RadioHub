import {test} from 'node:test';
import assert from 'node:assert/strict';
import {facebookHash,facebookProof,facebookVerifier,validFacebookState,facebookCallbackUrl} from '../src/auth/facebook-oauth-policy';
test('Facebook callback state is session bound, exact and short lived',()=>{
 const state='a'.repeat(64);
 assert.equal(validFacebookState(state,state,1000,1100),true);
 for(const actual of [undefined,['a'],state+'x','b'.repeat(64)])assert.equal(validFacebookState(state,actual,1000,1100),false);
 assert.equal(validFacebookState(state,state,1000,601001),false);
 assert.equal(validFacebookState(state,state,2000,1000),false);
});
test('mobile handoff requires an RFC7636 verifier and cannot accept URL/token payloads',()=>{
 const verifier='a'.repeat(64),challenge=facebookHash(verifier);
 assert.equal(facebookVerifier(verifier),true);assert.equal(facebookProof(challenge),true);
 for(const invalid of ['',[],null,'a'.repeat(42),'https://outside.test/token']){assert.equal(facebookProof(invalid),false);assert.equal(facebookVerifier(invalid),false);}
 assert.notEqual(facebookHash('b'.repeat(64)),challenge);
 assert.equal(facebookCallbackUrl({}),'https://api.themegaradio.com/api/auth/facebook/callback');
});
