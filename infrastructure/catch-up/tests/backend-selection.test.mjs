import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('DynamoDB e padrao; RDS somente com opt-in explicito em 04/05',()=>{
  const directory=mkdtempSync(join(tmpdir(),'catchup-selection-'));
  const script=fileURLToPath(new URL('../bootstrap.sh',import.meta.url));
  // SAM simulado: este teste verifica selecao sem acessar AWS ou criar recursos.
  writeFileSync(join(directory,'sam'),'#!/bin/sh\nprintf "%s\\n" "$@"\n',{mode:0o700});
  const env={...process.env,PATH:directory+':'+process.env.PATH};
  delete env.CATCH_UP_DATA_SOURCE;
  const plan=(baseline,extra={})=>execFileSync('bash',[script,'plan',baseline],{env:{...env,...extra},encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try {
    for(const baseline of ['ready-for-sprint-03','ready-for-sprint-04','ready-for-sprint-05']){
      const output=plan(baseline);
      assert.match(output,/components\/marketplace-backend\.yaml/);
      assert.doesNotMatch(output,/marketplace-backend-rds\.yaml/);
    }
    for(const baseline of ['ready-for-sprint-04','ready-for-sprint-05']) assert.match(plan(baseline,{CATCH_UP_DATA_SOURCE:'rds'}),/components\/marketplace-backend-rds\.yaml/);
    assert.throws(()=>plan('ready-for-sprint-05',{CATCH_UP_DATA_SOURCE:'rdss'}));
    assert.throws(()=>plan('ready-for-sprint-03',{CATCH_UP_DATA_SOURCE:'rds'}));
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('o novo default nao converte um ambiente RDS existente por acidente',()=>{
  const directory=mkdtempSync(join(tmpdir(),'catchup-rds-guard-'));
  const script=fileURLToPath(new URL('../bootstrap.sh',import.meta.url));
  writeFileSync(join(directory,'sam'),'#!/bin/sh\nexit 0\n',{mode:0o700});
  for(const dependency of ['npm','dotnet','zip']) writeFileSync(join(directory,dependency),'#!/bin/sh\nexit 0\n',{mode:0o700});
  writeFileSync(join(directory,'node'),'#!/bin/sh\nif [ "$1" = -p ]; then echo 24; else exit 99; fi\n',{mode:0o700});
  writeFileSync(join(directory,'aws'),`#!/bin/sh
case "$1 $2" in
  'sts get-caller-identity') echo 123456789012 ;;
  'cloudformation describe-stacks') echo existing.proxy.rds.amazonaws.com ;;
  *) echo 'AWS mutation unexpected' >&2; exit 99 ;;
esac
`,{mode:0o700});
  const env={...process.env,PATH:directory+':'+process.env.PATH,CATCH_UP_EXPECTED_ACCOUNT_ID:'123456789012'};
  delete env.CATCH_UP_DATA_SOURCE;
  delete env.CATCH_UP_POSTGRES_VERSION;
  try {
    assert.throws(()=>execFileSync('bash',[script,'apply','ready-for-sprint-04'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}),error=>{
      assert.match(error.stderr,/ja usa RDS.*Nao sera convertido para DynamoDB automaticamente/);
      assert.doesNotMatch(error.stderr,/AWS mutation unexpected/);
      return true;
    });
  } finally {rmSync(directory,{recursive:true,force:true});}
});
