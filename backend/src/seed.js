import {Store} from './store.js';
const db=new Store(process.env.DB_PATH||'./data/rca.sqlite');
const {SEED_EMAIL,SEED_PASSWORD,SEED_NAME}=process.env;
if(!SEED_EMAIL||!SEED_PASSWORD)throw new Error('Điền SEED_EMAIL và SEED_PASSWORD trong backend/.env');
if(db.one('SELECT id FROM users WHERE email=?',SEED_EMAIL.toLowerCase()))throw new Error('Email đã tồn tại; seed không thay mật khẩu.');
db.addUser(SEED_EMAIL,SEED_PASSWORD,SEED_NAME||SEED_EMAIL);db.db.close();console.log('Đã tạo tài khoản.');
