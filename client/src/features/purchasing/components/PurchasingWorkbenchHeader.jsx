import React from 'react';
import { uiText } from '../../../lib/i18n.js';

export default function PurchasingWorkbenchHeader({ loading, busy, onRefresh, canReadSourcing }) {
  return <>
    <div className="page-head"><div><h1>{uiText('Mua hàng và nhận hàng')}</h1><p className="sub">{uiText('Lập đơn mua, gửi duyệt, nhận đủ hoặc từng phần vào kho và theo dõi hóa đơn nhà cung cấp.')}</p></div><button className="btn btn-secondary" type="button" disabled={loading || Boolean(busy)} onClick={onRefresh}>{uiText('Làm mới')}</button></div>
    {canReadSourcing && <div className="row u-actions-end-mb-10"><a className="btn btn-secondary btn-sm" href="#/sourcing">{uiText('RFQ và so sánh báo giá')}</a></div>}
  </>;
}
