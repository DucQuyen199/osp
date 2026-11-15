import React from 'react';

const TABS = [
  ['business-time', 'Múi giờ nghiệp vụ'],
  ['currency', 'Currency'],
  ['users', 'Người dùng'], ['roles', 'Vai trò'], ['modules', 'Module'], ['fields', 'Trường mở rộng'],
  ['inventory', 'Kho'], ['budget', 'Ngân sách'], ['data', 'Dữ liệu'], ['tokens', 'API token'], ['audit', 'Nhật ký'],
  ['failures', 'Lỗi tích hợp'], ['outbox', 'Outbox tích hợp'],
];

export default function SettingsTabs({ active }) {
  return <nav className="tabs" role="tablist" aria-label="Mục cài đặt">
    {TABS.map(([key, label]) => <a key={key} className="tab" role="tab" aria-selected={key === active} href={`#/settings/${key}`}>{label}</a>)}
  </nav>;
}
