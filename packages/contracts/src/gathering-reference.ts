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
export const gatheringQuestionBank = [
  {
    "id": "games",
    "category": "互动游戏",
    "title": "想玩哪些游戏？",
    "type": "multiple",
    "options": [
      "真心话大冒险",
      "三国杀",
      "狼人杀",
      "UNO",
      "你画我猜",
      "谁是卧底",
      "剧本杀"
    ]
  },
  {
    "id": "snacks",
    "category": "吃喝偏好",
    "title": "想吃哪些零食？",
    "type": "multiple",
    "options": [
      "薯片",
      "魔芋爽",
      "牛肉粒",
      "饼干",
      "爆米花",
      "坚果",
      "巧克力"
    ]
  },
  {
    "id": "drinks",
    "category": "吃喝偏好",
    "title": "想喝哪些饮料？",
    "type": "multiple",
    "options": [
      "东方树叶",
      "可口可乐",
      "雪碧",
      "矿泉水",
      "果汁",
      "气泡水",
      "咖啡",
      "奶茶"
    ]
  },
  {
    "id": "fruit",
    "category": "吃喝偏好",
    "title": "想吃哪些水果？",
    "type": "multiple",
    "options": [
      "柚子",
      "橘子",
      "香蕉",
      "苹果",
      "葡萄",
      "西瓜",
      "草莓"
    ]
  },
  {
    "id": "activities",
    "category": "活动安排",
    "title": "想一起参加哪些活动？",
    "type": "multiple",
    "options": [
      "聚餐",
      "桌游",
      "唱歌",
      "看电影",
      "手作 DIY",
      "逛展",
      "公园散步",
      "露营野餐"
    ]
  },
  {
    "id": "meals",
    "category": "吃喝偏好",
    "title": "聚餐想吃什么？",
    "type": "multiple",
    "options": [
      "家常菜",
      "火锅／串串",
      "烧烤",
      "自助餐",
      "日式料理",
      "韩式料理",
      "西餐",
      "轻食／简餐"
    ]
  },
  {
    "id": "pace",
    "category": "活动安排",
    "title": "哪些活动节奏比较适合这次聚会？",
    "type": "multiple",
    "options": [
      "轻松不赶场",
      "适当安排几个项目",
      "丰富紧凑",
      "少转场",
      "留足自由聊天时间",
      "可以随时加入或离开"
    ]
  },
  {
    "id": "atmosphere",
    "category": "活动安排",
    "title": "这次聚会想要什么氛围？",
    "type": "multiple",
    "options": [
      "安静放松",
      "热闹欢乐",
      "温馨自在",
      "方便聊天",
      "大家一起互动",
      "有仪式感"
    ]
  },
  {
    "id": "avoid",
    "category": "活动安排",
    "title": "这次安排有哪些想避开的情况？",
    "type": "multiple",
    "options": [
      "人太挤",
      "烟味重",
      "环境嘈杂",
      "排队太久",
      "频繁转场",
      "路程太远",
      "结束太晚",
      "恐怖惊吓"
    ]
  },
  {
    "id": "suggestions",
    "category": "补充想法",
    "title": "还有什么想法或建议？",
    "type": "text",
    "options": []
  }
] as const;
