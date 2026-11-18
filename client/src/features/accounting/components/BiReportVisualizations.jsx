import React, { useEffect, useState } from 'react';
import { api, tenantPath } from '../../../lib/api.js';
import { fmtNumber, uiTextWith } from '../../../lib/i18n.js';
import biEnglish from '../bi.en.js';

const t = (text) => uiTextWith(text, biEnglish);
const asItems = (value) => Array.isArray(value?.items) ? value.items : [];
const label = (value) => String(value ?? '—');

export function BiDataTable({ items }) {
  const columns = items.length ? Object.keys(items[0]).filter((key) => !['id', 'tenantId', 'createdAt', 'updatedAt'].includes(key)) : [];
  if (!items.length) return <div className="empty"><h3>{t('Chưa có dữ liệu')}</h3><p>{t('Truy vấn đã lưu không trả về bản ghi nào.')}</p></div>;
  return <div className="table-wrap"><table className="table"><thead><tr>{columns.map((key) => <th scope="col" key={key}>{key}</th>)}</tr></thead>
    <tbody>{items.map((item, index) => <tr key={item.id || index}>{columns.map((key) => <td key={key} className={typeof item[key] === 'number' ? 'right num' : ''}>{typeof item[key] === 'number' ? fmtNumber(item[key]) : label(item[key])}</td>)}</tr>)}</tbody>
  </table></div>;
}

function pieSlicePath(start, end) {
  const point = (turn) => {
    const angle = turn * Math.PI * 2 - Math.PI / 2;
    return `${50 + Math.cos(angle) * 48} ${50 + Math.sin(angle) * 48}`;
  };
  const largeArc = end - start > 0.5 ? 1 : 0;
  return `M 50 50 L ${point(start)} A 48 48 0 ${largeArc} 1 ${point(end)} Z`;
}

export function BiReportWidget({ widget }) {
  const isKpi = widget.type === 'kpi';
  const resourceId = isKpi ? widget.kpi : widget.report;
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(tenantPath(isKpi
      ? `/reports/bi/kpis/${encodeURIComponent(resourceId)}`
      : `/reports/bi/${encodeURIComponent(resourceId)}`))
      .then((data) => { if (active) setResult(data); })
      .catch((reason) => { if (active) setError(t(reason.message || 'Không tải được báo cáo.')); });
    return () => { active = false; };
  }, [isKpi, resourceId]);
  if (error) return <div className="alert danger" role="alert">{t(error)}</div>;
  if (!result) return <div className="skeleton" data-h="row" />;
  if (isKpi) return <div className="stat"><span className="stat-label">{result.name}</span><strong className="stat-value num">{fmtNumber(result.value)}</strong><span className="small">{t('Target:')} {result.target == null ? '—' : fmtNumber(result.target)}{result.attainmentPercent == null ? '' : ` · ${fmtNumber(result.attainmentPercent)}%`}</span></div>;
  const items = asItems(result);
  if (widget.type === 'table') return <BiDataTable items={items} />;
  if (widget.type === 'number') return <div className="stat"><span className="stat-label">{result.name}</span><strong className="stat-value num">{fmtNumber(String(items[0]?.value ?? 0))}</strong></div>;
  const max = Math.max(1, ...items.map((item) => Math.abs(Number(item.value) || 0)));
  if (!items.length) return <div className="empty"><p>{t('Chưa có dữ liệu cho biểu đồ.')}</p></div>;
  if (widget.type === 'pie') {
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);
    let cursor = 0;
    const chartColor = (index) => `var(--chart-${(index % 7) + 1})`;
    const slices = items.map((item) => {
      const start = cursor;
      cursor += total > 0 ? Math.max(0, Number(item.value) || 0) / total : 1 / items.length;
      return { start, end: cursor };
    });
    return <div className="bi-pie-wrap"><div className="bi-pie" role="img" aria-label={`${result.name}: ${items.length} nhóm`}><svg viewBox="0 0 100 100" aria-hidden="true">{items.length === 1
      ? <circle cx="50" cy="50" r="48" fill={total > 0 ? chartColor(0) : 'var(--chart-empty)'} />
      : total === 0 ? <circle cx="50" cy="50" r="48" fill="var(--chart-empty)" />
        : items.map((item, index) => <path key={`${item.group}:${index}`} d={pieSlicePath(slices[index].start, slices[index].end)} fill={chartColor(index)} />)}</svg></div>
      <ul className="bi-legend">{items.map((item, index) => <li key={`${item.group}:${index}`}><span className="bi-swatch" aria-hidden="true"><svg viewBox="0 0 1 1"><rect width="1" height="1" fill={chartColor(index)} /></svg></span>{label(item.group)} <strong>{fmtNumber(String(item.value ?? 0))}</strong></li>)}</ul></div>;
  }
  if (widget.type === 'line') {
    const points = items.map((item, index) => `${items.length < 2 ? 50 : 8 + index / (items.length - 1) * 84},${90 - (Number(item.value) || 0) / max * 76}`).join(' ');
    return <div className="bi-line-chart"><svg viewBox="0 0 100 100" role="img" aria-label={`${result.name}: biểu đồ đường`} preserveAspectRatio="none"><line x1="8" y1="90" x2="92" y2="90" className="bi-axis" /><polyline points={points} className="bi-line" />{items.map((item, index) => <circle key={`${item.group}:${index}`} cx={items.length < 2 ? 50 : 8 + index / (items.length - 1) * 84} cy={90 - (Number(item.value) || 0) / max * 76} r="1.6" className="bi-point"><title>{label(item.group)}: {fmtNumber(String(item.value ?? 0))}</title></circle>)}</svg><div className="bi-line-labels">{items.map((item, index) => <span key={`${item.group}:${index}`} title={label(item.group)}>{label(item.group)}</span>)}</div></div>;
  }
  return <div className="bi-bars" role="list" aria-label={result.name}>{items.map((item, index) => <div className="bi-bar-row" role="listitem" key={`${item.group}:${index}`}>
    <span title={label(item.group)}>{label(item.group)}</span><div className="bi-bar-track"><svg className="bi-bar-fill" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true"><rect width={Math.max(2, Math.abs(Number(item.value) || 0) / max * 100)} height="1" /></svg></div><strong className="num">{fmtNumber(String(item.value ?? 0))}</strong>
  </div>)}</div>;
}

export function BiKpiCard({ kpi }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(tenantPath(`/reports/bi/kpis/${encodeURIComponent(kpi.id)}`))
      .then((data) => { if (active) setResult(data); })
      .catch((reason) => { if (active) setError(t(reason.message || 'Không thể tính KPI.')); });
    return () => { active = false; };
  }, [kpi.id]);
  return <article className="card bi-link-card">
    <strong>{kpi.name}</strong>
    {error ? <span className="small danger-text">{t(error)}</span> : result
      ? <><span className="stat-value num">{fmtNumber(result.value)}</span><span className="small">Target: {result.target == null ? '—' : fmtNumber(result.target)}{result.attainmentPercent == null ? '' : ` · ${fmtNumber(result.attainmentPercent)}%`}</span></>
      : <span className="skeleton" data-h="row" />}
  </article>;
}
