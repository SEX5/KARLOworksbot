// secrets.js
module.exports = {
    // IMPORTANT: Use the "Transaction Pooler" URL from Supabase.
    // It must end with port :6543
    DATABASE_URL: "postgresql://postgres.vburnklpeuvxswtrugbp:[YOUR-PASSWORD]@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres",
    // --- Other secrets ---
    PAGE_ACCESS_TOKEN: "EAA5a1El5oeIBPcqXg2AY2y0reyZAOnRj2GIveLqop4ibLMoTQZBNo7w2fkLaO6ZCvssgfhOsndEPiyZCv59SguqWt7bARCBtLBrZBB9Mbjkem5ZAtK06u9qTNv8Mj6z1fhZBMN3O7SWBwZACSEJjVTNCYxiat0tp7HChOPvrIhagCwX0j4faZBiZA3zthfrGd0C7iMRTMvQRoe1GAuSJJIWTwRkn9FdwZDZD",
    VERIFY_TOKEN: "pinkGuineaFowl_onpella_2025",
    ADMIN_ID: "9022271741140377",
    GEMINI_API_KEY: "AIzaSyCAIMkQPtvM8aei8QigSyBxD8WoP2hYAQI",
    KAIZ_API_KEY: "732ce71f-4761-474d-adf2-5cd2d315ad18", // Your new Kaiz-APIs key
    BOT_URL: "https://apiworker.onrender.com", 

    // A secure, random password that the Python worker uses to talk to your bot.
    WORKER_SECRET_TOKEN: "CREATE_A_LONG_AND_SECRET_WORKER_PASSWORD_HERE" 
}; 
