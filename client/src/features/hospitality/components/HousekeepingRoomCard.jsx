import React from 'react';

export default function HousekeepingRoomCard({
  room,
  roomHref,
  busy,
  maintenanceReason,
  canMaintenance,
  canReady,
  canSubmitMaintenance,
  fmtAgo,
  fmtDate,
  t,
  onMaintenanceReasonChange,
  onSetMaintenance,
  onMarkReady,
}) {
  return <article className={`card housekeeping-card${room.priority === 'today' ? ' due-today' : ''}`}>
        <header className="card-head">
          <div><a href={roomHref}><strong>{t('Phòng')} {room.number}</strong></a><div className="small muted">{room.roomType || t('Chưa rõ loại phòng')}{room.floor ? ` · ${t('Tầng')} ${room.floor}` : ''}</div></div>
          {room.status === 'maintenance' ? <span className="badge danger">{t('B\u1ea3o tr\u00ec')}</span> : room.priority === 'today' && <span className="badge danger">{t('\u01afu ti\u00ean h\u00f4m nay')}</span>}
        </header>
        <div className="housekeeping-detail">
          <div><span className="small muted">{room.status === 'maintenance' ? t('L\u00fd do b\u1ea3o tr\u00ec') : t('Tr\u1ea3 ph\u00f2ng g\u1ea7n nh\u1ea5t')}</span><strong>{room.status === 'maintenance' ? room.maintenanceReason : room.lastCheckout ? fmtDate(room.lastCheckout) : t('Ch\u01b0a c\u00f3 l\u1ecbch s\u1eed tr\u1ea3 ph\u00f2ng')}</strong><span className="small muted">{room.dirtySince && room.status === 'cleaning' ? `${t('Ch\u1edd d\u1ecdn')} ${fmtAgo(room.dirtySince)}` : ''}</span></div>
          <div><span className="small muted">{t('Lượt đến tiếp theo')}</span><strong>{room.nextArrival ? fmtDate(room.nextArrival) : t('Chưa xếp khách vào phòng này')}</strong><span className="small muted">{room.priority === 'today' ? t('Khách đến hôm nay') : t('Kiểm tra lịch nhận phòng')}</span></div>
        </div>
        {room.status === 'cleaning' && canMaintenance && <div className="row wrap housekeeping-footer"><label className="field"><span className="label">{t('Ghi nh\u1eadn h\u01b0 h\u1ecfng / c\u1ea7n b\u1ea3o tr\u00ec')}</span><input className="input" maxLength="500" value={maintenanceReason} onChange={(event) => onMaintenanceReasonChange(event.target.value)} placeholder={t('M\u00f4 t\u1ea3 v\u1ea5n \u0111\u1ec1 c\u1ea7n x\u1eed l\u00fd')} /></label><button className="btn btn-secondary" type="button" disabled={Boolean(busy) || !canSubmitMaintenance} onClick={onSetMaintenance}>{t('\u0110\u01b0a v\u00e0o b\u1ea3o tr\u00ec')}</button></div>}
        {canReady && <footer className="row housekeeping-footer"><span className="small muted">{room.status === 'maintenance' ? t('Ch\u1ec9 \u0111\u00e1nh d\u1ea5u s\u1eb5n s\u00e0ng sau khi s\u1eeda ch\u1eefa v\u00e0 ki\u1ec3m tra') : t('X\u00e1c nh\u1eadn sau khi \u0111\u00e3 d\u1ecdn v\u00e0 ki\u1ec3m tra')}</span><span className="grow" /><button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={onMarkReady}>{busy === room.id ? t('\u0110ang c\u1eadp nh\u1eadt\u2026') : t('\u0110\u00e1nh d\u1ea5u s\u1eb5n s\u00e0ng')}</button></footer>}
      </article>
;}