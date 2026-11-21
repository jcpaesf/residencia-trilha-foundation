import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {repositoryVariables,validateSubject} from '../repository-variables.mjs';

test('aceita subjects tradicionais e imutaveis, somente do fork e main',()=>{
  for(const subject of ['repo:aluno/fork:ref:refs/heads/main','repo:aluno@123/fork@456:ref:refs/heads/main']) assert.equal(validateSubject('aluno/fork',subject),subject);
  for(const subject of ['repo:outro/fork:ref:refs/heads/main','repo:aluno/fork:*','repo:aluno/fork:pull_request','repo:aluno/fork:environment:production','repo:aluno/fork:ref:refs/heads/dev','repo:aluno@123/fork:ref:refs/heads/main']) assert.throws(()=>validateSubject('aluno/fork',subject));
  assert.throws(()=>validateSubject('aluno/fork','repo:aluno/fork:ref:refs/heads/main\n'));
});

test('gera todas as variables dos workflows a partir dos outputs AWS',()=>{
  const items=object=>Object.entries(object).map(([OutputKey,OutputValue])=>({OutputKey,OutputValue}));
  const web=items({FrontendBucketName:'bucket-web',CloudFrontDistributionId:'D123',FrontendUrl:'https://example.cloudfront.net'});
  const backend=items({UserPoolId:'us-east-1_pool',UserPoolClientId:'client',ApiUrl:'https://api.example.com/prod',CatalogFunctionName:'test-catalog',OrderApiFunctionName:'test-orders',OrderProcessorFunctionName:'test-processor'});
  const identity=items({FrontendDeployRoleArn:'arn:aws:iam::123456789012:role/frontend',BackendDeployRoleArn:'arn:aws:iam::123456789012:role/backend'});
  const result=repositoryVariables('us-east-1',web,backend,identity);
  assert.equal(Object.keys(result).length,13);
  const workflowVariables=new Set(['frontend','backend'].flatMap(name=>{
    const yaml=readFileSync(new URL(`../../../.github/workflows/${name}.yml`,import.meta.url),'utf8');
    return [...yaml.matchAll(/\bvars\.([A-Z_][A-Z_0-9]*)/g)].map(match=>match[1]);
  }));
  assert.deepEqual([...workflowVariables].sort(),Object.keys(result).sort(),'O catch-up deve gerar exatamente as variables usadas pelos workflows oficiais');
  assert.equal(result.FRONTEND_BUCKET,'bucket-web');
  assert.equal(result.BACKEND_AWS_ROLE_ARN,identity[1].OutputValue);
  assert.equal(result.VITE_API_URL,'https://api.example.com/prod');
  assert.throws(()=>repositoryVariables('us-east-1',web,[],identity));
  assert.ok(!Object.keys(result).some(name=>/PASSWORD|SECRET|ACCESS_KEY/.test(name)));
});
