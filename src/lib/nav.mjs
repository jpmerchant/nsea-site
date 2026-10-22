import { pages, utility } from '../data/site.mjs';

const byPath = new Map(pages.map((p) => [p.path, p]));

export const parentPath = (path) => {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? '/' + parts.join('/') + '/' : '/';
};

export const hrefOf = (p) => (p.type === 'link' ? p.url : p.path);
export const isExternal = (p) => p.type === 'link';
export const getPage = (path) => byPath.get(path);

export const children = (path) => pages.filter((p) => parentPath(p.path) === path);
export const crossLinks = (path) => pages.filter((p) => (p.also || []).includes(path));
export const topLevel = pages.filter((p) => parentPath(p.path) === '/' && p.type === 'hub');
export const tools = pages.filter((p) => p.type === 'tool');

// Dropdown = direct children of a top-level hub (never deeper, so menus stay short)
// ...plus any deeper page flagged `feature` (e.g. Check My Time), shown first.
export const dropdown = (hub) => {
  const kids = children(hub.path);
  const deep = pages.filter((p) => p.feature && p.path.startsWith(hub.path) && !kids.includes(p) && p.type !== 'hub');
  return [...deep, ...kids];
};

export const breadcrumbs = (path) => {
  const trail = [];
  let p = parentPath(path);
  while (p !== '/') {
    const e = byPath.get(p);
    if (e) trail.unshift(e);
    p = parentPath(p);
  }
  return trail;
};

export const statusLabel = {
  ready: 'Ready',
  pull: 'Pull from BUILD',
  rebuild: 'Rebuild',
  new: 'New',
};

export { pages, utility };
