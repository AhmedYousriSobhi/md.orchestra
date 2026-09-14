import { h } from '../utils/dom.js';

export function renderBreadcrumb(container, path, rootId, rootLabel, onSelect) {
  container.innerHTML = '';
  const atRoot = path.length === 0;
  const crumbs = [
    h('button', { class: `crumb crumb-root${atRoot ? ' crumb-current' : ''}`, type: 'button', disabled: atRoot, onClick: () => onSelect(rootId) }, rootLabel || 'Document'),
  ];
  path.forEach((node, i) => {
    crumbs.push(h('span', { class: 'crumb-sep' }, '›'));
    const isLast = i === path.length - 1;
    crumbs.push(
      h(
        'button',
        { class: `crumb${isLast ? ' crumb-current' : ''}`, type: 'button', disabled: isLast, onClick: () => onSelect(node.id) },
        node.title,
      ),
    );
  });
  crumbs.forEach((c) => container.appendChild(c));
}
