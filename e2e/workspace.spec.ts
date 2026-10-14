import { test, expect } from '@playwright/test';

test('request and response panels remain usable in the viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  const editor = page.getByRole('region', { name: 'Request editor' });
  const viewer = page.getByRole('region', { name: 'Response viewer' });
  await expect(editor).toBeVisible();
  await expect(viewer).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize request and response panels' })).toBeVisible();
  const a = await editor.boundingBox(), b = await viewer.boundingBox();
  expect(a?.height).toBeGreaterThan(160);
  expect(b?.height).toBeGreaterThan(160);
  expect((b?.y || 0) + (b?.height || 0)).toBeLessThanOrEqual(page.viewportSize()!.height + 2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-workspace.png` });
});

test('parameter rows scroll inside the request panel instead of disappearing', async ({ page }) => {
  await page.goto('/');
  const editor = page.locator('.request-editor-content');
  await expect(editor.getByRole('button', { name: 'Add row' })).toBeVisible();
  for (let i = 0; i < 18; i++) await editor.getByRole('button', { name: 'Add row' }).click();
  expect(await editor.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await editor.getByRole('button', { name: 'Add row' }).scrollIntoViewIfNeeded();
  await expect(editor.getByRole('button', { name: 'Add row' })).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Response viewer' })).toBeVisible();
});

test('keyboard splitter resizing is persisted after reload', async ({ page }, testInfo) => {
  await page.goto('/');
  const separator = page.getByRole('separator', { name: 'Resize request and response panels' });
  const initial = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await separator.press('ArrowDown');
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial + 5));
  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial + 5));
  await page.screenshot({ path: `test-results/${testInfo.project.name}-resized.png` });
});

test('mobile toolbar remains inside the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-specific layout');
  await page.goto('/');
  const theme = page.getByTitle('Switch to light theme');
  await expect(theme).toBeVisible();
  const rect = await theme.boundingBox();
  expect((rect?.x || 0) + (rect?.width || 0)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const menu = page.locator('details.data-menu');
  await expect(menu.locator('summary')).toBeVisible();
  await menu.locator('summary').click();
  await expect(page.getByRole('button', { name: 'Export backup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import backup' })).toBeVisible();
  const popup = await page.locator('.data-menu-popup').boundingBox();
  expect(popup).not.toBeNull();
  expect((popup?.x || 0) + (popup?.width || 0)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(popup?.y).toBeGreaterThanOrEqual(0);
});


test('proxy cookie jar is opt-in and persists locally without using network', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Request URL' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Request URL' }).fill('https://api.example.com/auth');
  await page.getByRole('button', { name: 'Cookie Jar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cookie Jar' });
  await expect(dialog).toBeVisible();
  const toggle = dialog.getByRole('checkbox', { name: 'Enable Cloud Proxy cookie capture and sending' });
  await expect(toggle).not.toBeChecked();
  await dialog.getByRole('textbox', { name: 'Cookie name' }).fill('qa-session');
  await dialog.getByLabel('Cookie value').fill('secret-123');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText('qa-session')).toBeVisible();
  await toggle.check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Cookie Jar' }).click();
  await expect(dialog.getByText('qa-session')).toBeVisible();
  await expect(toggle).toBeChecked();
  await dialog.getByRole('button', { name: 'Delete cookie qa-session' }).click();
  await expect(dialog.getByText('qa-session')).toHaveCount(0);
});


test('Local Agent pairing UI keeps its token in tab memory only', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Local Agent' });
  await expect(dialog).toBeVisible();
  const token = dialog.getByLabel('Agent pairing token');
  await token.fill('temporary-key-never-persisted');
  await expect(dialog.getByText('127.0.0.1:47831', { exact: false }).first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Local Agent' }).getByLabel('Agent pairing token')).toHaveValue('');
});


test('gRPC unary console offers proto import, target, RPC method and JSON editors', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name:'gRPC Console' }).click();
  const dialog=page.getByRole('dialog', { name:'gRPC Console' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('gRPC target')).toHaveValue('grpc://127.0.0.1:50051');
  await expect(dialog.getByLabel('gRPC service')).toHaveValue('demo.Greeter');
  await expect(dialog.getByLabel('gRPC method')).toHaveValue('SayHello');
  await expect(dialog.getByLabel('gRPC proto')).toHaveValue(/service Greeter/);
  await expect(dialog.getByLabel('gRPC request JSON')).toBeVisible();
  await expect(dialog.getByLabel('gRPC metadata JSON')).toBeVisible();
  await expect(dialog.getByRole('button', { name:'Invoke RPC' })).toBeDisabled();
  await dialog.getByRole('button', { name:'Pair Agent' }).click();
  await expect(page.getByRole('dialog', { name:'Local Agent' })).toBeVisible();
});


test('gRPC supports local schema files and reflection selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name:'gRPC Console' }).click();
  const dialog=page.getByRole('dialog', { name:'gRPC Console' });
  await expect(dialog.getByRole('button', { name:'Local .proto files' })).toBeVisible();
  await expect(dialog.getByRole('button', { name:'Choose files' })).toBeVisible();
  await dialog.getByRole('button', { name:'Server Reflection' }).click();
  await expect(dialog.getByRole('button', { name:'List services' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name:'Load RPC methods' })).toBeDisabled();
  await expect(dialog.getByText('reflection API')).toBeVisible();
  await dialog.getByRole('button', { name:'Local .proto files' }).click();
  await expect(dialog.getByLabel('gRPC proto')).toBeVisible();
});


test('saved gRPC RPC is listed in Collections and restored after reload', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name:'gRPC Console' }).click();
  const dialog = page.getByRole('dialog', { name:'gRPC Console' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name:'Saved gRPC name' }).fill('Demo Watch');
  await dialog.getByRole('combobox', { name:'gRPC call mode' }).selectOption('server-stream');
  await dialog.getByRole('button', { name:'Save', exact:true }).click();
  await expect(dialog.getByText('Saved to collection.')).toBeVisible();
  await dialog.getByTitle('Close').click();
  await page.reload();
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name:'Toggle menu' }).click();
  await page.getByRole('button', { name:/RPC Demo Watch/ }).click();
  const restored = page.getByRole('dialog', { name:'gRPC Console' });
  await expect(restored.getByRole('textbox', { name:'Saved gRPC name' })).toHaveValue('Demo Watch');
  await expect(restored.getByRole('combobox', { name:'gRPC call mode' })).toHaveValue('server-stream');
});


test('gRPC interactive streaming shows send, half-close and cancel controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name:'gRPC Console' }).click();
  const dialog=page.getByRole('dialog', { name:'gRPC Console' });
  await dialog.getByRole('combobox', { name:'gRPC call mode' }).selectOption('bidi');
  await expect(dialog.getByRole('button', { name:'Start session' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name:'Send message' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name:'Half-close' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name:'Cancel' })).toBeDisabled();
  await dialog.getByRole('combobox', { name:'gRPC call mode' }).selectOption('client-stream');
  await dialog.getByRole('textbox', { name:'Saved gRPC name' }).fill('Streaming preset');
  await dialog.getByRole('button', { name:'Save', exact:true }).click();
  await expect(dialog.getByText('Saved to collection.')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name:'gRPC call mode' })).toHaveValue('client-stream');
});


test('exported ReqDock JSON v3 backup contains saved gRPC definitions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name:'gRPC Console' }).click();
  const dialog = page.getByRole('dialog', { name:'gRPC Console' });
  await dialog.getByRole('textbox', { name:'Saved gRPC name' }).fill('Exportable RPC');
  await dialog.getByRole('combobox', { name:'gRPC call mode' }).selectOption('bidi');
  await dialog.getByRole('button', { name:'Save', exact:true }).click();
  await expect(dialog.getByText('Saved to collection.')).toBeVisible();
  await dialog.getByTitle('Close').click();
  const download = page.waitForEvent('download');
  await page.locator('details.data-menu > summary').click();
  await page.getByRole('button', { name:'Export backup' }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const content = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(content.version).toBe(3);
  expect(content.grpcRequests).toEqual([expect.objectContaining({name:'Exportable RPC',callMode:'bidi'})]);
});


test('Collection Runner offers distinct HTTP and gRPC queues',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Run',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Collection runner'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'HTTP',exact:true})).toHaveClass(/active/);
  await dialog.getByRole('button',{name:'gRPC',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'gRPC',exact:true})).toHaveClass(/active/);
  await expect(dialog.getByText('Requires the paired Local Agent.',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Export report'})).toBeDisabled();
  await dialog.getByRole('button',{name:'HTTP',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'HTTP',exact:true})).toHaveClass(/active/);
});


test('Postman script editor is opt-in and keeps safe DSL as the default', async ({page})=>{
  await page.goto('/');
  await page.getByRole('tab',{name:'Tests',exact:true}).click();
  const language=page.getByRole('combobox',{name:'Script language'});
  await expect(language).toHaveValue('dsl');
  await language.selectOption('postman');
  await expect(page.getByText('synchronous JavaScript in a separate',{exact:false})).toBeVisible();
  await language.selectOption('dsl');
  await expect(language).toHaveValue('dsl');
});


test('Postman JS runs before/after through isolated worker and displays assertions',async({page})=>{
  await page.route('https://api.example.test/demo-token',async route=>{
    await route.fulfill({
      status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*'},
      body:JSON.stringify({ok:true,value:'demo-token'}),
    });
  });
  await page.goto('/');
  await page.getByRole('textbox',{name:'Request URL'}).fill('https://api.example.test/{{token}}');
  await page.getByRole('tab',{name:'Tests'}).click();
  await page.getByRole('combobox',{name:'Script language'}).selectOption('postman');
  await page.locator('.script-textarea').first().fill('pm.environment.set("token", "demo-token");');
  await page.locator('.script-textarea').nth(1).fill(
    'pm.test("JS status 200", () => pm.expect(pm.response.code).to.eql(200));\n'+
    'pm.test("JS response body", () => pm.expect(pm.response.json().value).to.eql("demo-token"));',
  );
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByText('JS status 200')).toBeVisible({timeout:15000});
  await expect(page.getByText('JS response body')).toBeVisible();
});


test('encrypted sync previews initial cloud revision and uploads with expected revision',async({page})=>{
  let saved=null;
  await page.route('**/api/sync',async route=>{
    if(route.request().method()==='GET'){
      if(!saved){await route.fulfill({status:404,contentType:'application/json',body:'{"error":"Not found"}'});return;}
      await route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({encrypted:saved.encrypted,revision:1,updatedAt:new Date().toISOString()})});
      return;
    }
    saved=route.request().postDataJSON();
    await route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,revision:1,updatedAt:new Date().toISOString()})});
  });
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('/');
  await page.getByRole('button',{name:'Encrypted cloud sync'}).click();
  const dialog=page.getByRole('dialog',{name:'Encrypted cloud backup'});
  await dialog.getByLabel('Server sync key').fill('example-key');
  await dialog.getByLabel('Encryption passphrase').fill('test-secret-passphrase');
  await dialog.getByRole('button',{name:'Review sync changes'}).click();
  const preview=dialog.getByLabel('Cloud sync review');
  await expect(preview).toBeVisible();
  await expect(preview.getByText('Review cloud revision 0')).toBeVisible();
  await preview.getByRole('button',{name:'Confirm synchronized merge'}).click();
  await expect(dialog.getByRole('status')).toContainText('Synchronized successfully');
  expect(saved.expectedRevision).toBe(0);
  expect(saved.encrypted.version).toBe(1);
  expect(saved.encrypted.ciphertext).toBeTruthy();
});


test('cloud history can restore an archived ciphertext as a new revision', async ({page}) => {
  const revisions: {revision:number;updatedAt:string;encrypted:unknown}[]=[];
  await page.route('**/api/sync**',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    const latest=revisions.at(-1);
    if(request.method()==='GET'){
      if(url.searchParams.has('history')){
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({history:[...revisions].reverse().map(x=>({
            revision:x.revision,updatedAt:x.updatedAt,
          }))})});
        return;
      }
      const want=url.searchParams.get('revision');
      const found=want?revisions.find(x=>x.revision===Number(want)):latest;
      if(!found){
        await route.fulfill({status:404,contentType:'application/json',body:'{"error":"No snapshot"}'});
        return;
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(found)});
      return;
    }
    const sent=request.postDataJSON();
    const expected=latest?.revision||0;
    if(sent.expectedRevision!==expected){
      await route.fulfill({status:409,contentType:'application/json',body:'{"error":"Conflict"}'});
      return;
    }
    const next={encrypted:sent.encrypted,revision:expected+1,updatedAt:new Date().toISOString()};
    revisions.push(next);
    await route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,revision:next.revision,updatedAt:next.updatedAt})});
  });
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('/');
  await page.getByRole('button',{name:'Encrypted cloud sync'}).click();
  const dialog=page.getByRole('dialog',{name:'Encrypted cloud backup'});
  await dialog.getByLabel('Server sync key').fill('demo-sync-key');
  await dialog.getByLabel('Encryption passphrase').fill('another-long-test-passphrase');
  await dialog.getByRole('button',{name:'Review sync changes'}).click();
  await expect(dialog.getByLabel('Cloud sync review')).toBeVisible();
  await dialog.getByRole('button',{name:'Confirm synchronized merge'}).click();
  await expect(dialog.getByRole('status')).toContainText('Synchronized successfully');
  expect(revisions).toHaveLength(1);
  await dialog.getByRole('button',{name:'List history'}).click();
  await expect(dialog.getByLabel('Cloud history versions')).toContainText('Revision 1');
  await dialog.getByRole('button',{name:'Inspect'}).click();
  await expect(dialog.getByLabel('Historical restore preview')).toContainText('Current cloud revision: 1');
  await dialog.getByRole('button',{name:'Restore as new revision'}).click();
  await expect(dialog.getByRole('status')).toContainText('Restored historical revision 1 as new cloud revision 2');
  expect(revisions).toHaveLength(2);
  expect(revisions[1].revision).toBe(2);
  expect(revisions[1].encrypted).toEqual(revisions[0].encrypted);
});


test('opt-in auto sync remains active after closing dialog and stops on refresh',async({page})=>{
  let revision=0, encrypted:unknown=null;
  const uploads:{expectedRevision:number;encrypted:unknown}[]=[];
  await page.route('**/api/sync**',async route=>{
    if(route.request().method()==='GET'){
      if(!revision){await route.fulfill({status:404,contentType:'application/json',body:'{"error":"No snapshot"}'});return;}
      await route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({revision,updatedAt:new Date().toISOString(),encrypted})});
      return;
    }
    const sent=route.request().postDataJSON() as {expectedRevision:number;encrypted:unknown};
    if(sent.expectedRevision!==revision){
      await route.fulfill({status:409,contentType:'application/json',body:'{"error":"stale"}'});return;
    }
    uploads.push(sent);encrypted=sent.encrypted;revision++;
    await route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,revision,updatedAt:new Date().toISOString()})});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Encrypted cloud sync'}).click();
  const dialog=page.getByRole('dialog',{name:'Encrypted cloud backup'});
  await dialog.getByLabel('Server sync key').fill('test-sync-key');
  await dialog.getByLabel('Encryption passphrase').fill('test-secret-passphrase');
  await dialog.getByRole('button',{name:'Enable auto sync'}).click();
  await expect(dialog.getByRole('button',{name:'Stop auto sync'})).toBeVisible();
  await dialog.getByTitle('Close').click();
  await expect.poll(()=>revision,{timeout:15000}).toBe(1);
  await expect(page.getByRole('button',{name:'Encrypted cloud sync'}))
    .toHaveAttribute('title',/revision 1/i);
  expect(uploads).toHaveLength(1);
  expect(uploads[0].expectedRevision).toBe(0);
  // No changes must not generate extra cloud history revisions on focus.
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(350);
  expect(revision).toBe(1);
  await page.reload();
  await page.getByRole('button',{name:'Encrypted cloud sync'}).click();
  await expect(page.getByRole('button',{name:'Enable auto sync'})).toBeDisabled();
  await expect(dialog.getByLabel('Server sync key')).toHaveValue('');
  await expect(dialog.getByLabel('Encryption passphrase')).toHaveValue('');
});
