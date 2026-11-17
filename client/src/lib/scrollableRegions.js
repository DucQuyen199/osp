function accessibleName(region) {
  const table = region.querySelector('table');
  const caption = table?.querySelector('caption')?.textContent?.trim();
  if (caption) return caption;

  const section = region.closest('section, .card');
  const heading = section?.querySelector('h1, h2, h3, h4')?.textContent?.trim();
  if (heading) return heading;

  const columns = [...(table?.querySelectorAll('thead th') || [])]
    .map((cell) => cell.textContent.trim())
    .filter(Boolean);
  return columns.length ? columns.join(', ').slice(0, 180) : 'Bảng dữ liệu';
}

function updateRegion(region) {
  const canScroll = region.scrollWidth > region.clientWidth + 1;
  if (canScroll) {
    region.tabIndex = 0;
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', accessibleName(region));
  } else if (region.dataset.scrollRegion === 'enhanced') {
    region.removeAttribute('tabindex');
    region.removeAttribute('role');
    region.removeAttribute('aria-label');
  }
  region.dataset.scrollRegion = 'enhanced';
}

export function enhanceScrollableRegions(root) {
  if (!root || typeof ResizeObserver === 'undefined') return () => {};

  const observed = new Set();
  const resizeObserver = new ResizeObserver((entries) => {
    entries.forEach(({ target }) => updateRegion(target));
  });
  const observe = (region) => {
    if (observed.has(region)) return;
    observed.add(region);
    resizeObserver.observe(region);
    const table = region.querySelector('table');
    if (table) resizeObserver.observe(table);
    updateRegion(region);
  };
  const scan = (node) => {
    if (!(node instanceof Element)) return;
    if (node.matches('.table-wrap')) observe(node);
    node.querySelectorAll('.table-wrap').forEach(observe);
  };

  scan(root);
  const mutationObserver = new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach(scan));
  });
  mutationObserver.observe(root, { childList: true, subtree: true });

  return () => {
    mutationObserver.disconnect();
    resizeObserver.disconnect();
  };
}
