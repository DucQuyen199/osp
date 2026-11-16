import { useEffect } from 'react';

export default function NotFoundPage() {
  useEffect(() => { document.title = 'Không tìm thấy trang · OSP Suite'; }, []);
  return <div className="page">
    <div className="card card-pad empty not-found-page">
      <span className="not-found-code">404</span>
      <h1>Không tìm thấy trang</h1>
      <p>Đường dẫn này không tồn tại hoặc màn hình đã được chuyển đi.</p>
      <a className="btn btn-primary" href="#/">Về trang chủ</a>
    </div>
  </div>;
}
