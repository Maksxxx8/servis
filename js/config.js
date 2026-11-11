/**
 * config.js — Дефолтна база даних (конфігурація салону, спеціалісти, послуги, приклади записів)
 */

const todayStr = new Date().toISOString().split('T')[0];

export const defaultDB = {
  salon: {
    name: "Beauty Studio • Світлана & Марія",
    address: "м. Дніпро • Щодня 09:00–20:00",
    workStart: 9,
    workEnd: 20,
    adminPin: "1234",
    tgBotToken: "",
    tgChatId: ""
  },
  masters: [
    {
      id: "m1",
      name: "Світлана",
      role: "Майстер-бровіст",
      bio: "Архітектура, фарбування та ламінування брів",
      avatar: "✨",
      tgChatId: ""
    },
    {
      id: "m2",
      name: "Марія",
      role: "Майстер манікюру",
      bio: "Апаратний манікюр, укріплення гелем, педикюр",
      avatar: "💅",
      tgChatId: ""
    }
  ],
  services: [
    { id: "s1", masterId: "m1", title: "Архітектура + корекція та фарбування брів", duration: 60, price: 500 },
    { id: "s2", masterId: "m1", title: "Ламінування брів (повний комплекс)", duration: 60, price: 650 },
    { id: "s3", masterId: "m1", title: "Корекція брів (віск / пінцет)", duration: 30, price: 300 },
    { id: "s4", masterId: "m2", title: "Манікюр комплекс (зняття + гігієна + гель-лак)", duration: 90, price: 650 },
    { id: "s5", masterId: "m2", title: "Манікюр з укріпленням гелем / полігелем", duration: 120, price: 800 },
    { id: "s6", masterId: "m2", title: "Гігієнічний манікюр без покриття", duration: 60, price: 400 }
  ],
  appointments: [
    {
      id: "a1", masterId: "m1", serviceIds: ["s1"], date: todayStr, time: "11:00",
      duration: 60, price: 500, clientName: "Олена", clientPhone: "+380671112233",
      status: "confirmed", notes: "Тон темно-русий, чутлива шкіра"
    },
    {
      id: "a2", masterId: "m2", serviceIds: ["s4"], date: todayStr, time: "12:00",
      duration: 90, price: 650, clientName: "Марина", clientPhone: "+380509998877",
      status: "pending", notes: "Молочна база, мигдаль 2"
    }
  ]
};

export { todayStr };
