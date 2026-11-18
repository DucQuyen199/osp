import React from 'react';

export default function HousekeepingMaintenanceForm({
  vacantRooms,
  roomId,
  reason,
  busy,
  onRoomChange,
  onReasonChange,
  onSubmit,
  t,
}) {
  return <section className="card card-pad housekeeping-maintenance-form">
    <h2>{t('\u0110\u01b0a ph\u00f2ng tr\u1ed1ng v\u00e0o b\u1ea3o tr\u00ec')}</h2>
    {vacantRooms.length ? <form className="row wrap" onSubmit={onSubmit}>
      <label className="field"><span className="label">{t('Ph\u00f2ng tr\u1ed1ng')}</span><select className="select" required value={roomId} onChange={(event) => onRoomChange(event.target.value)}><option value="">{t('Ch\u1ecdn ph\u00f2ng c\u1ea7n b\u1ea3o tr\u00ec')}</option>{vacantRooms.map((room) => <option key={room.id} value={room.id}>{room.number}{room.floor ? ` \u00b7 ${t('T\u1ea7ng')} ${room.floor}` : ''}</option>)}</select></label>
      <label className="field grow"><span className="label">{t('L\u00fd do b\u1ea3o tr\u00ec *')}</span><input className="input" required maxLength="500" value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder={t('M\u00f4 t\u1ea3 v\u1ea5n \u0111\u1ec1 c\u1ea7n x\u1eed l\u00fd')} /></label>
      <button className="btn btn-secondary" type="submit" disabled={Boolean(busy) || !roomId || !reason.trim()}>{t('\u0110\u01b0a v\u00e0o b\u1ea3o tr\u00ec')}</button>
    </form> : <p className="small muted">{t('Kh\u00f4ng c\u00f3 ph\u00f2ng tr\u1ed1ng \u0111\u1ec3 \u0111\u01b0a v\u00e0o b\u1ea3o tr\u00ec.')}</p>}
  </section>;
}
