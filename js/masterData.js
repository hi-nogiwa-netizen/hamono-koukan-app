// 刃物交換指示表.xlsx から抽出した初期マスタデータ。
// 管理画面（マスタ管理タブ）から製品・工具・機械の追加編集が可能。
// このファイルは Realtime Database が空のときに投入される「初期データ」としてのみ使われる。

export const SEED_PRODUCTS = [
  {
    id: "NN-32YB2",
    name: "NN-32YB2（刃物交換指示表）",
    machines: [
      { name: "NC55", cycleTimeSec: null },
      { name: "NC56", cycleTimeSec: null },
      { name: "NC68", cycleTimeSec: null },
      { name: "NC69", cycleTimeSec: null },
      { name: "NC84", cycleTimeSec: null },
      { name: "NC85", cycleTimeSec: null },
    ], // cycleTimeSec（1サイクルの秒数）はマスタ管理タブから設定可能
    dailyQty: 400, // 1日あたりの生産数（設定数）。出社時残寿命の目安計算に使用。
    tools: [
      { no: "T01", process: "外径荒", maker: "住友", model: "CNMG120405N-GU(AC603M)", processCount: 1, life: 500 },
      { no: "T02", process: "外径仕上げ", maker: "住友", model: "DCMT11T304N-LU(AC6030M)", processCount: 2, life: 2600 },
      { no: "T04", process: "ツバ裏17°テーパー", maker: "京セラ", model: "VBGT110302MR-F(PR1225)", processCount: 1, life: 10200 },
      { no: "T05", process: "溝入れ", maker: "京セラ", model: "GDM3020N-040GM(PR1535)", processCount: 1, life: 4100 },
      { no: "T06", process: "突切り", maker: "京セラ", model: "GDM2020N-020PM(PR1535)", processCount: 1, life: 1000 },
      { no: "T10", process: "φ19.13　荒取り", maker: "三菱", model: "VF-SFPR 12", processCount: 1, life: 12200 },
      { no: "T11", process: "φ19.13　仕上げ", maker: "NACHI", model: "RVMSUS4080G-2.5D", processCount: 2, life: 40400 },
      { no: "T12", process: "センター穴、φ2.0穴面、φ4.1ザグリ穴面", maker: "イワタツール", model: "90SPC1.0×3SECBALD", processCount: 2, life: 10200 },
      { no: "T13", process: "φ4.2　ザグリ穴", maker: "OSG", model: "FX-ZDS 4.2", processCount: 1, life: 10200 },
      { no: "T14", process: "φ2.3　穴", maker: "三菱", model: "VAPDSSUSD0230", processCount: 1, life: 4100 },
      { no: "T40", process: "φ11.523　内径仕上げ", maker: "タンガロイ", model: "EPGT040104-JS(SH730)", processCount: 1, life: 2100 },
      { no: "T41", process: "φ11.523　テーパー部　荒取り", maker: "住友", model: "CCMT060204N-SU(AC6030M)", processCount: 1, life: 3100 },
      { no: "T42", process: "φ11.523　下穴", maker: "石川工具", model: "φ11.4×33L(先端角R0.4)", processCount: 1, life: 5100 },
      { no: "T43", process: "センター、φ3.1穴面、キー溝正面側面取り", maker: "石川工具", model: "SP-SMC2060CST 先端径φ5.0×12L", processCount: 2, life: 20400 },
      { no: "T44", process: "φ3.1　穴　先端角138°", maker: "三菱", model: "VAPDSSUSD0310", processCount: 3, life: 3900 },
      { no: "T45", process: "φ6.2　穴　先端角140°", maker: "NACHI", model: "AGSUSS6.2", processCount: 1, life: 1600 },
      { no: "T46", process: "φ2.3　交差穴バリ取り", maker: "三菱", model: "VAPDSSUSD0230", processCount: 1, life: 20200 },
      { no: "T47", process: "φ2.0　交差穴裏バリ取り（面取り）", maker: "XEBEC", model: "XC-18-A", processCount: 1, life: 8200 },
      { no: "T48", process: "キー溝、C面（外径側）", maker: "石川工具", model: "φ4.7×2L（φ6シャンクC面刃付）", processCount: 1, life: 8200 },
      { no: "T50", process: "外径、端面仕上げ", maker: "住友", model: "SCGT09T304L-FX(AC1030U)", processCount: 1, life: 10200 },
    ],
  },
];

// 交換優先度のしきい値（残り寿命の割合）
export const PRIORITY_THRESHOLDS = {
  danger: 0.1, // 残り10%未満 → 至急交換
  warning: 0.3, // 残り30%未満 → まもなく交換
};
