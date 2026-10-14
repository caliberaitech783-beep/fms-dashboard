const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guardedVolvoFetch } = require('../src/lib/volvo/volvoRequestGate');
const { VolvoRfmsClient } = require('../src/lib/volvo/volvoRfmsClient');

test('queued requests receive their full HTTP timeout after admission', async () => {
  let calls = 0;
  const fetchFn = guardedVolvoFetch(async (_url, options) => {
    assert.equal(options.signal.aborted, false);
    assert.equal(options.onRequestStart, undefined);
    calls++;
    return new Response('{}');
  });
  const client = new VolvoRfmsClient({baseUrl:"https://example.test", username:'test', password:'test', timeoutMs:30, retries:0, fetchFn });
  await Promise.all([client.request('vehicles'), client.request('vehicles'), client.request('vehicles')]);
  assert.equal(calls, 3);
});

test('HTTP timeout still aborts a slow admitted request', async () => {
  const fetchFn = guardedVolvoFetch((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true});
  }));
  const client = new VolvoRfmsClient({baseUrl:"https://example.test",username:'test',password:'test',timeoutMs:30,retries:0,fetchFn});
  await assert.rejects(client.request('vehicles'), error => error.statusCode === 504);
});

test('HTTP timeout remains active while reading the response body', async () => {
  const fetchFn = guardedVolvoFetch(async (_url, options) => ({ok:true,text:()=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
  })}));
  const client = new VolvoRfmsClient({baseUrl:"https://example.test",username:'test',password:'test',timeoutMs:30,retries:0,fetchFn});
  await assert.rejects(client.request('vehicles'), error => error.statusCode === 504);
});

