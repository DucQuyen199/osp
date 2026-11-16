import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { uiText } from '../../lib/i18n.js';
export default function NotFoundPage() {
  useDocumentTitle(`${uiText('Không tìm thấy trang')} · OSP Suite`);
  return <div className="page">
    <div className="card card-pad empty not-found-page">
      <span className="not-found-code">404</span>
      <h1>{uiText('Không tìm thấy trang')}</h1>
      <p>{uiText('Đường dẫn này không tồn tại hoặc màn hình đã được chuyển đi.')}</p>
      <a className="btn btn-primary" href="#/">{uiText('Về trang chủ')}</a>
    </div>
  </div>;
}
