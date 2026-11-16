import { Component } from 'react';

export default class RouteErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Route failed to render', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <div className="page">
        <section className="card card-pad route-error" role="alert">
          <h1>Không thể tải màn hình</h1>
          <p>Màn hình này gặp lỗi khi hiển thị. Hãy tải lại ứng dụng hoặc quay về trang chủ.</p>
          <div className="row wrap">
            <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>Tải lại ứng dụng</button>
            <a className="btn btn-secondary" href="#/">Về trang chủ</a>
          </div>
        </section>
      </div>;
    }

    return this.props.children;
  }
}
