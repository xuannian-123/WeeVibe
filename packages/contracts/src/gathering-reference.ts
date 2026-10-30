import type { gatheringKeywordGroups } from './gatherings';
/** UI vocabulary transcribed from the user supplied HTML, 2026-10-28. */
export const gatheringSections: readonly {id: 'do'|'want'|'avoid';title:string;groups:readonly {id:typeof gatheringKeywordGroups[number];title:string;options:readonly string[];rowBreak?:number}[]}[] = [
  {
    "id": "do",
    "title": "干什么",
    "groups": [
      {
        "id": "eat",
        "title": "吃",
        "options": [
          "常规中餐",
          "辣中餐：川渝湘赣",
          "火锅／串串",
          "烧烤",
          "自助餐",
          "西餐",
          "日式",
          "韩式（含烤肉）",
          "东南亚菜",
          "小吃／夜市",
          "轻食／简餐",
          "其他"
        ]
      },
      {
        "id": "drink",
        "title": "喝",
        "options": [
          "咖啡",
          "奶茶／果汁／甜品",
          "茶馆",
          "清吧",
          "夜店",
          "其他"
        ],
        "rowBreak": 3
      },
      {
        "id": "play",
        "title": "玩",
        "options": [
          "看展",
          "唱歌",
          "桌游/棋牌",
          "电影演出",
          "剧本杀/密室逃脱",
          "打卡",
          "手作DIY",
          "电玩城",
          "室内运动",
          "露营",
          "散步",
          "骑行",
          "室外运动"
        ],
        "rowBreak": 9
      }
    ]
  },
  {
    "id": "want",
    "title": "想要",
    "groups": [
      {
        "id": "pace",
        "title": "活动节奏",
        "options": [
          "轻松不赶场",
          "适当安排",
          "丰富紧凑"
        ]
      },
      {
        "id": "atmosphere",
        "title": "氛围",
        "options": [
          "安静放松",
          "热闹欢乐",
          "温馨自在",
          "有仪式感"
        ]
      },
      {
        "id": "experience",
        "title": "体验",
        "options": [
          "适合拍照",
          "方便聊天",
          "尝试新鲜事物",
          "大家一起互动"
        ]
      },
      {
        "id": "arrangement",
        "title": "安排",
        "options": [
          "少转场",
          "地点相近",
          "交通方便"
        ]
      },
      {
        "id": "venue",
        "title": "场地偏好",
        "options": [
          "室内为主",
          "户外为主",
          "室内外结合",
          "都可以"
        ]
      }
    ]
  },
  {
    "id": "avoid",
    "title": "想避开",
    "groups": [
      {
        "id": "environment",
        "title": "环境",
        "options": [
          "人太挤",
          "烟味重",
          "环境嘈杂"
        ]
      },
      {
        "id": "travel",
        "title": "安排",
        "options": [
          "排队久",
          "频繁转场",
          "路程太远",
          "结束太晚"
        ]
      },
      {
        "id": "exertion",
        "title": "体力与刺激",
        "options": [
          "高强度运动",
          "长时间走路",
          "长时间站立",
          "爬坡爬楼",
          "恐怖惊吓"
        ]
      }
    ]
  }
] as const;
