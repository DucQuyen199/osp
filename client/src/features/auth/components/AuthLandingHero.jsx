import React from 'react';

export default function AuthLandingHero({ moduleCount, verticalCount, t }) {
  return <section className="landing-hero" aria-label={t('Giới thiệu')}>
    <a className="brand" href="#/login"><span className="brand-mark">O</span>OSP Suite</a>
    <div><h1>{t('Một hệ thống cho cả doanh nghiệp, đúng với ngành của bạn.')}</h1><p>{t('CRM, bán hàng, kho, kế toán, nhân sự… dùng chung một nguồn dữ liệu. Làm ở đâu, các bước còn lại tự chạy theo.')}</p></div>
    <ul className="hero-points"><li>{moduleCount} {t('module, bật dần theo nhu cầu')}</li><li>{verticalCount} {t('gói ngành với thuật ngữ và quy trình sẵn có')}</li><li>{t('Dữ liệu của bạn: xuất toàn bộ bất cứ lúc nào')}</li></ul>
  </section>;
}
