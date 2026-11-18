import React from 'react';

/** Controlled site setup, diary entry, and saved diary history. */
export default function ConstructionSiteDiaryPanel({
  projects = [],
  projectSites = [],
  projectDiaries = [],
  selectedProject,
  siteForm,
  diaryForm,
  busy,
  canCreateSite,
  canCreateDiary,
  today,
  fmtDate,
  onSiteFieldChange,
  onDiaryFieldChange,
  onCreateSite,
  onCreateDiary,
  t,
}) {
  return <section className="card card-pad">
    <h2>{t('Nhật ký công trường')}</h2>
    {canCreateSite && <form className="form-grid" onSubmit={onCreateSite}>
      <h3 className="full">{t('Tạo công trường')}</h3>
      <label className="field"><span className="label">{t('Tên công trường *')}</span><input className="input" required value={siteForm.name} onChange={(event) => onSiteFieldChange('name', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Địa chỉ')}</span><input className="input" value={siteForm.address} onChange={(event) => onSiteFieldChange('address', event.target.value)} /></label>
      <label className="field full"><span className="label">{t('Dự án')}</span><select className="select" value={siteForm.project} onChange={(event) => onSiteFieldChange('project', event.target.value)}>
        <option value="">{t('Không gắn dự án')}</option>{projects.filter((project) => ['planned', 'active'].includes(project.status)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      <div className="row full"><span className="grow"/><button className="btn btn-secondary" disabled={Boolean(busy) || !['planned', 'active'].includes(selectedProject?.status)}>{t('Tạo công trường')}</button></div>
    </form>}
    {canCreateDiary && projectSites.length > 0 && ['planned', 'active'].includes(selectedProject?.status) && <form className="form-grid u-mt-14" onSubmit={onCreateDiary}>
      <h3 className="full">{t('Ghi nhật ký thi công')}</h3>
      <label className="field"><span className="label">{t('Công trường *')}</span><select className="select" required value={diaryForm.site} onChange={(event) => onDiaryFieldChange('site', event.target.value)}>{projectSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      <label className="field"><span className="label">{t('Ngày *')}</span><input className="input" required type="date" max={today()} value={diaryForm.date} onChange={(event) => onDiaryFieldChange('date', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Thời tiết')}</span><input className="input" value={diaryForm.weather} onChange={(event) => onDiaryFieldChange('weather', event.target.value)} /></label>
      <label className="field"><span className="label">{t('Diễn biến, nhân lực, thiết bị')}</span><textarea className="input" rows="3" value={diaryForm.notes} onChange={(event) => onDiaryFieldChange('notes', event.target.value)} /></label>
      <div className="row full"><span className="grow"/><button className="btn btn-primary" disabled={Boolean(busy)}>{t('Ghi nhật ký')}</button></div>
    </form>}
    <div className="table-wrap u-mt-16"><table className="table">
      <thead><tr><th>{t('Ngày')}</th><th>{t('Công trường')}</th><th>{t('Thời tiết')}</th><th>{t('Ghi nhận')}</th></tr></thead>
      <tbody>{projectDiaries.map((row) => <tr key={row.id}><td>{fmtDate(row.date)}</td><td>{projectSites.find((site) => site.id === row.site)?.name || '—'}</td><td>{row.weather || '—'}</td><td>{row.notes || '—'}</td></tr>)}</tbody>
    </table></div>
  </section>;
}