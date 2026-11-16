import React from 'react';
import { uiText } from '../../lib/i18n.js';

const TABS = [
  ['business-time', 'Múi giờ nghiệp vụ'],
  ['currency', 'Tiền tệ'],
  ['users', 'Người dùng'], ['roles', 'Vai trò'], ['modules', 'Phân hệ'], ['fields', 'Trường mở rộng'],
  ['inventory', 'Tồn kho'], ['budget', 'Ngân sách'], ['data', 'Dữ liệu'], ['tokens', 'API token'], ['audit', 'Nhật ký'],
  ['failures', 'Lỗi tích hợp'], ['outbox', 'Hàng đợi tích hợp'],
];

export default function SettingsTabs({ active }) {
  return <nav className="tabs" role="tablist" aria-label={uiText('Mục cài đặt')}>
    {TABS.map(([key, label]) => <a key={key} className="tab" role="tab" aria-selected={key === active} href={`#/settings/${key}`}>{uiText(label)}</a>)}
  </nav>;
}
