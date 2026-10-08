import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const localNodeRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const en = localNodeRequire('../src/messages/en.json');
const sr = localNodeRequire('../src/messages/sr-Latn.json');
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  const compiledModule = {exports: {}};
  const localRequire = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'server-only') return {};
    const resolved = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
    if (resolved.endsWith('.json')) return localNodeRequire(resolved);
    return load(path.relative(root, resolved + '.ts'), mocks);
  };
  vm.runInNewContext(code, {module: compiledModule, exports: compiledModule.exports, require: localRequire, process, console}, {filename});
  return compiledModule.exports;
}
const {createUiTranslator} = load('src/i18n/ui.ts');
const {normalizeLocale, isLocale} = load('src/i18n/config.ts');
test('catalogs cover both languages with identical interpolation fields', () => {
  assert.deepEqual(Object.keys(sr).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof sr[key], 'string', key);
    const fields = text => (text.match(/\{\w+\}/g) || []).sort();
    assert.deepEqual(fields(sr[key]), fields(en[key]), en[key]);
  }
});
test('every explicit UI message has a catalog entry', () => {
  const messages = new Set(Object.values(en));
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file)) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        function visit(node) {
          if (ts.isCallExpression(node) && node.expression.getText(source) === 'ui' && node.arguments[0]) {
            function literals(value) {
              if (ts.isStringLiteral(value)) assert.ok(messages.has(value.text), `${file}: ${value.text}`);
              ts.forEachChild(value, literals);
            }
            literals(node.arguments[0]);
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  walk(path.join(root, 'src'));
});
test('translation replaces variables without translating authored values', () => {
  const ui = createUiTranslator('sr-Latn');
  assert.equal(ui('Save'), 'Sačuvaj');
  assert.equal(createUiTranslator('en')('Save'), 'Save');
  const key = Object.values(en).find(text => text.includes('{v0}') && sr[Object.keys(en).find(k => en[k] === text)] !== text);
  const authored = 'English course title <b>& text';
  assert.ok(ui(key, {v0: authored}).includes(authored));
  assert.equal(ui('My authored course description'), 'My authored course description');
  assert.equal(ui.optionLabel('Save', '11111111-1111-4111-8111-111111111111'), 'Save');
  assert.equal(ui.optionLabel('Save', 'save'), 'Sačuvaj');
  assert.equal(ui(null), null);
  assert.equal(ui(undefined), undefined);
  assert.equal(isLocale('sr'), false);
  assert.equal(normalizeLocale('../../secrets'), 'en');
});
test('app and course preferences persist separately; invalid input cannot write cookies', async () => {
  const values = new Map();
  const store = {get: key => values.has(key) ? {value: values.get(key)} : undefined, set: (key, value, options) => {assert.equal(options.httpOnly, true); values.set(key, value);}, delete: key => values.delete(key)};
  const actions = load('src/services/locale.ts', {'next/headers': {cookies: async () => store}});
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  await actions.setUserLocale('sr-Latn');
  await actions.setUserLocale('en', a);
  assert.equal(await actions.getUserLocale(), 'sr-Latn');
  assert.equal(values.get(`COURSE_LOCALE_${a}`), 'en');
  assert.equal(values.has(`COURSE_LOCALE_${b}`), false);
  await actions.clearCourseLocale(a);
  assert.equal(values.has(`COURSE_LOCALE_${a}`), false);
  await assert.rejects(actions.setUserLocale('de'));
  await assert.rejects(actions.setUserLocale('en', 'bad-course'));
});
test('course defaults and explicit overrides work before and after migration', async () => {
  let result = {data: {default_language: 'sr-Latn'}, error: null};
  let override;
  const query = {select: () => query, eq: () => query, maybeSingle: async () => result};
  const course = load('src/i18n/course.ts', {
    react: {cache: fn => fn},
    'next/headers': {cookies: async () => ({get: () => override === undefined ? undefined : {value: override}})},
    '@/lib/supabase/server': {createServerSupabaseClient: async () => ({from: () => query})}
  });
  assert.equal(await course.getCourseLocale('course-a'), 'sr-Latn');
  override = 'en';
  assert.equal(await course.getCourseLocale('course-a'), 'en');
  override = 'unsupported';
  assert.equal(await course.getCourseLocale('course-a'), 'sr-Latn');
  result = {data: null, error: {message: "column courses.default_language does not exist"}};
  const unavailable = await course.getCourseLanguage('course-a');
  assert.equal(unavailable.available, false);
  assert.equal(await course.getCourseLocale('course-a'), 'en');
  result = {data: null, error: {message: 'Connection unavailable'}};
  await assert.rejects(course.getCourseLanguage('course-a'));
});
