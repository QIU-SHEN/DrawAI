import { validateDocument, defaultLayers, defaultShape } from '../../src/model.js';
export function exampleDocument() {
  return validateDocument({
    version: 2,
    layers: defaultLayers(),
    table: { layerId: 'data', x: -610, y: -100 },
    nodes: [
      { id: 'standard', kind: 'input', title: '标准图', description: '已框选商品区域', x: -650, y: -105 },
      { id: 'photo', kind: 'input', title: '现场图', description: '当前门店陈列照片', x: -650, y: 145 },
      { id: 'agent2', kind: 'agent', title: 'AGENT 2', description: '比对图片，识别缺货差异', x: -395, y: 0 },
      { id: 'blur', kind: 'decision', title: '图片模糊', description: '图片质量检查', x: -395, y: -245 },
      { id: 'retake', kind: 'result', title: '重拍', description: '重新采集现场图', x: -140, y: -245 },
      { id: 'agent3', kind: 'agent', title: 'AGENT 3', description: '判断未上架或位置变化', x: -125, y: 245 },
      { id: 'pass1', kind: 'result', title: '✓1 上架通过', description: '当前商品已上架', x: 130, y: 0 },
      { id: 'agent4', kind: 'agent', title: 'AGENT 4', description: '判断腰封是否符合标准', x: 395, y: 0 },
      { id: 'pass2', kind: 'result', title: '✓2 合格', description: '腰封符合标准', x: 660, y: 0 },
      { id: 'fail2', kind: 'result', title: '×2 不合格', description: '腰封需要调整', x: 660, y: 245 },
      { id: 'sku', kind: 'input', title: '确认 SKU', description: '读取商品区域编号', x: 145, y: 300 },
      { id: 'missing', kind: 'result', title: '× 缺货', description: '记录待补货商品', x: 400, y: 300 },
    ].map(n => ({ ...n, layerId: 'flow', shape: defaultShape(n.kind) })),
    edges: [
      ['standard', 'agent2', ''], ['photo', 'agent2', ''], ['agent2', 'blur', ''], ['blur', 'retake', ''],
      ['agent2', 'pass1', '无缺货差异'], ['agent2', 'agent3', '存在差异'], ['agent3', 'pass1', '已上架'],
      ['agent3', 'sku', '未上架'], ['sku', 'missing', ''], ['pass1', 'agent4', ''], ['agent4', 'pass2', ''], ['agent4', 'fail2', ''],
    ].map(([source, target, label], i) => ({ id: `edge-${i}`, source, target, label })),
    rows: [
      { id: 'check1', item: '图片差异', status: '待检查', agentIds: ['agent2'], note: '' },
      { id: 'check2', item: '上架状态', status: '待检查', agentIds: ['agent3'], note: '' },
      { id: 'check3', item: '腰封标准', status: '待检查', agentIds: ['agent4'], note: '' },
    ],
  });
}
