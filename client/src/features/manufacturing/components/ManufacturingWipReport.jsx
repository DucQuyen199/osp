import React from 'react';

export default function ManufacturingWipReport({ report, qty, fmtMoney, statusLabel, t }) {
  return <>
      {!report.orders?.length ? <div className="empty"><h3>{t("Không có số dư WIP theo lệnh")}</h3><p>{t("Chưa có vật tư được xuất cho lệnh đang chạy, hoặc thành phẩm đạt QC đã được nhập kho.")}</p></div> : <div className="card table-wrap"><table className="table">
        <thead><tr><th scope="col">{t("Lệnh sản xuất")}</th><th scope="col">{t("Thành phẩm")}</th><th scope="col">{t("Trạng thái")}</th><th scope="col">{t("QC")}</th><th scope="col" className="right">{t("Kế hoạch")}</th><th scope="col" className="right">{t("Đạt")}</th><th scope="col" className="right">{t("Phế phẩm")}</th><th scope="col" className="right">{t("Giá trị NVL")}</th><th scope="col" className="right">{t("Đã nhập")}</th><th scope="col" className="right">{t("Loại bỏ QC")}</th><th scope="col" className="right">{t("Còn WIP")}</th></tr></thead>
        <tbody>{report.orders.map((order) => <tr key={order.id}>
          <td>{order.id}</td><td>{order.product}</td><td>{statusLabel(order.status)}</td><td>{order.qualityStatus ? statusLabel(order.qualityStatus) : t("Chưa tạo QC")}</td>
          <td className="right">{qty(order.plannedQty)}</td><td className="right">{qty(order.goodQty)}</td><td className="right" title={order.scrapReason || undefined}>{qty(order.scrapQty)}</td>
          <td className="right money">{fmtMoney(order.materialCost)}</td><td className="right money">{fmtMoney(order.finishedCost)}</td><td className="right money">{fmtMoney(order.qcScrapCost)}</td><td className="right money"><strong>{fmtMoney(order.wipValue)}</strong></td>
        </tr>)}</tbody>
      </table></div>}
      <p className="faint">{t('Giá trị tính theo phiếu kho phát sinh đến')} {report.asOf}{t('. Trạng thái QC phản ánh trạng thái hiện tại; số dư âm theo lệnh vẫn được hiển thị để phục vụ đối chiếu.')}</p>
  </>;
}
